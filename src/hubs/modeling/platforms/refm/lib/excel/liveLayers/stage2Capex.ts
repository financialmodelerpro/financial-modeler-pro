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
import { resolveCatalogId } from '../../state/costCatalog';
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { capexCols } from '../buildModelWorkbook';
import { capexCostType, CAPEX_COST_TYPES } from '../capexCostType';

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
import { planCapexSpread, planCapexBlends, followedRule, usedSpreads, planPhasingTable, SPREAD_BASIS_ROW, type SpreadBasis } from './capexSpread';

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
        if (!['own', 'inherit', 'land_cash', 'collections', 'sales', 'commission_terms'].includes(src)) refuse.push(`${where} follows ${src}`);
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
    // THE PHASING TABLE (2026-11-19): every even or curve share a formula reads is a row of % by year on Inputs.
    const blends0 = planCapexBlends(state, members, plan, (a) => isRetailCompanion(a));
    const used = usedSpreads(plan, blends0);
    const table = planPhasingTable(state, plan, used, snap.projectStartYear, N);
    const tableRowOf = (key: string) => { const i = table.rowOfSpread.get(key); return i === undefined ? undefined : table.rows[i]; };
    if (table.rows.length && !w.has('inpph:head')) refuse.push('the construction phasing table is not on Inputs');
    for (const sp of plan.rows.values()) {
      const tabled = sp.kind === 'even' || sp.kind === 'curve';
      if (tabled && !used.has(sp.key)) continue;
      if (!w.has(`cxw:${sp.key}`)) refuse.push(`the spend share "${sp.label}" is not on the sheet`);
      if (tabled && !(tableRowOf(sp.key) && w.has(tableRowOf(sp.key)!.keys[0]))) refuse.push(`the phasing of ${sp.label} is not on the construction phasing table`);
      if (sp.kind === 'collections' && !w.has(`rvc:${sp.assetId}:${SPREAD_BASIS_ROW[sp.basis ?? 'cash']}`)) refuse.push(`the revenue row ${sp.label} reads is not on Revenue`);
      if (sp.kind === 'blend' && (!w.has(`ctin|${sp.assetId}|pct`) || !w.has(`ctin|${sp.assetId}|rem`))) refuse.push(`the commission terms of ${sp.label} are not on Inputs`);
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

    // ── The spend shares: a phase's construction year of each model year, then one row per profile ──────
    for (const ph of phases) {
      if (!w.has(`cxpp:${ph.id}`)) continue;
      const pr = w.addr(`cxpp:${ph.id}`).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: pr, col: cP(t) }, `${P(3, cP(t))}-YEAR(${w.ref(`tl:phase:${ph.id}:cs`)})+1`);
    }
    const doneRows = new Set<number>();
    for (const sp of plan.rows.values()) {
      if ((sp.kind === 'even' || sp.kind === 'curve') && !used.has(sp.key)) continue;
      const r = w.addr(`cxw:${sp.key}`).row;
      const ph = phases.find((p) => p.id === sp.phaseId)!;
      const cp = (): string => w.ref(`tl:phase:${ph.id}:cp`);
      const S = w.addr(`cxw:${sp.key}`).sheet;
      if (S !== CAPEX) {
        // ON REVENUE (2026-11-15, founder): the line's collections inside the phase's years over their
        // total there, even over the window where they say nothing; the window and the phase period of
        // each year are worked out in the formula, so the row carries no working columns.
        // THE COMMISSION TERMS (2026-11-18): the share on contract on the sale year's share, the rest on the
        // collections' or the handover's, as Inputs says (commissionShape, the engine's rule).
        if (sp.kind === 'blend') {
          const part = (b: SpreadBasis): ((c: number) => string) | null => {
            const k = sp.parts?.[b];
            if (!k || !w.has(`cxw:${k}`)) return null;
            const a0 = w.addr(`cxw:${k}`);
            return (c: number) => w.refP({ sheet: a0.sheet, row: a0.row, col: c }, S);
          };
          const sF = part('sold'), cF = part('cash'), hF = part('rec');
          const pct = `MAX(0,MIN(1,N(${w.ref(`ctin|${sp.assetId}|pct`)})))`;
          const rem = w.ref(`ctin|${sp.assetId}|rem`);
          const any = (sF ?? cF ?? hF)!;
          const remF = (c: number): string => { const h = hF ?? cF ?? any, co = cF ?? hF ?? any; return h === co ? co(c) : `IF(${rem}="At handover",${h(c)},${co(c)})`; };
          for (let t = 0; t < N; t++) {
            const c = cP(t);
            w.fA({ sheet: S, row: r, col: c }, !sF ? remF(c) : (!cF && !hF) ? sF(c) : `${pct}*${sF(c)}+(1-${pct})*${remF(c)}`);
          }
          w.fA({ sheet: S, row: r, col: C_TOT }, `SUM(${w.rangeA(S, r, cP(0), cP(N - 1)).replace(/^'?[^!]+'?!/, '')})`);
          continue;
        }
        if (sp.kind !== 'collections') return values(`the spend share "${sp.label}" is on ${S}`);
        const rule = followedRule(sp.baseId);
        let B: string, C: string;
        if (sp.win === 'follows') {
          B = rule === 'land' ? '0' : rule === 'half' ? `MAX(1,INT(${cp()}/2))` : rule === 'preop' ? `MAX(1,${cp()}-6)` : '1';
          C = rule === 'land' ? '0' : `MAX(${B},${cp()})`;
        } else {
          const ir = sp.win === 'plot' ? inpRow(sp.assetId!, sp.lineId) : firstWindowRow.get(sp.lineId);
          if (ir === undefined) return values(`the window of ${sp.label} has no input row`);
          B = inp(ir, 6); C = inp(ir, 7);
        }
        const first = `MAX(${axis()},YEAR(${w.ref(`tl:phase:${ph.id}:cs`)}))`;
        const yr = (c: number): string => w.refP({ sheet: S, row: 3, col: c }, S);
        const i1 = (c: number): string => `(${yr(c)}-${first}+1)`;
        const p0 = sp.win !== 'follows' || rule === 'land';
        const even = (c: number): string => `(${p0 ? `(${yr(c)}=MAX(${axis()},${first}-1))*(${B}<=0)+` : ''}(${i1(c)}>=MAX(1,${B}))*(${i1(c)}<=MAX(${B},${C})))/(MAX(${B},${C})-${B}+1)`;
        const cash = w.addr(`rvc:${sp.assetId}:${SPREAD_BASIS_ROW[sp.basis ?? 'cash']}`);
        const slots = `${cp()}+${w.ref(`tl:phase:${ph.id}:op`)}+1`;
        // The phase's years (1 = yes) on their own row (2026-11-15: short formulas).
        const inK = `cxw:${sp.key}|in`;
        const inR = w.has(inK) ? w.addr(inK).row : 0;
        if (inR) for (let t = 0; t < N; t++) { const c = cP(t); w.fA({ sheet: S, row: inR, col: c }, `(${i1(c)}>=1)*(${i1(c)}<=${slots})`); }
        const inF = (c: number): string => (inR ? w.refP({ sheet: S, row: inR, col: c }, S) : `(${i1(c)}>=1)*(${i1(c)}<=${slots})`);
        const yrs = w.rangeA(S, 3, cP(0), cP(N - 1)).replace(/^'?[^!]+'?!/, '');
        const ppr = `(${yrs}-${first}+1)`;
        const inRng = inR ? w.rangeA(S, inR, cP(0), cP(N - 1)).replace(/^'?[^!]+'?!/, '') : '';
        w.fA({ sheet: S, row: r, col: C_OPEN }, inR ? `SUMPRODUCT(${inRng},${w.rangeA(cash.sheet, cash.row, cP(0), cP(N - 1))})` : `SUMPRODUCT((${ppr}>=1)*(${ppr}<=${slots}),${w.rangeA(cash.sheet, cash.row, cP(0), cP(N - 1))})`);
        const W = w.refA({ sheet: S, row: r, col: C_OPEN }, S);
        // The even fallback on its own row: a window that follows the construction years (from year 1 or
        // later) reads Timeline's construction year number of the phase (2026-11-15: short formulas).
        const evK = `cxw:${sp.key}|even`;
        const evR = w.has(evK) ? w.addr(evK).row : 0;
        const ctrK = `tl:ctr:${ph.id}:con`;
        if (evR) for (let t = 0; t < N; t++) {
          const c = cP(t);
          const viaCtr = sp.win === 'follows' && rule !== 'land' && w.has(ctrK);
          w.fA({ sheet: S, row: evR, col: c }, viaCtr ? `(${w.refP({ sheet: 'Timeline', row: w.addr(ctrK).row, col: c }, S)}>=${B})/(MAX(${B},${cp()})-${B}+1)` : even(c));
        }
        for (let t = 0; t < N; t++) {
          const c = cP(t);
          w.fA({ sheet: S, row: r, col: c }, `IF(${W}>0,${inF(c)}*${w.refP({ sheet: cash.sheet, row: cash.row, col: c }, S)}/${W},${evR ? w.refP({ sheet: S, row: evR, col: c }, S) : even(c)})`);
        }
        w.fA({ sheet: S, row: r, col: C_TOT }, `SUM(${w.rangeA(S, r, cP(0), cP(N - 1)).replace(/^'?[^!]+'?!/, '')})`);
        continue;
      }
      // THE YEAR'S % ON THE PHASING TABLE OVER THE ROW'S TOTAL (2026-11-19, founder): the engine slices a curve to
      // the line's window and normalises it; the table holds each profile already sliced, so a link is the whole rule.
      if (sp.kind !== 'even' && sp.kind !== 'curve') return values(`the spend share "${sp.label}" is driven by revenue and is not on Revenue`);
      if (doneRows.has(r)) continue;
      doneRows.add(r);
      const ppKey = `cxpp:${ph.id}`;
      if (!w.has(ppKey)) return values(`the construction years of ${ph.name} are not on the sheet`);
      const ppr = w.addr(ppKey).row;
      const trow = tableRowOf(sp.key)!;
      const head = w.addr('inpph:head').row, tr = w.addr(trow.keys[0]).row;
      const c1 = 2, c2 = 1 + (table.kMax - table.kMin + 1);
      const hdr = w.rangeA(INPUTS, head, c1, c2), rng = w.rangeA(INPUTS, tr, c1, c2);
      w.fA({ sheet: CAPEX, row: r, col: 2 }, trow.standard ? `SUMIF(${hdr},"<="&${w.ref(`tl:phase:${ph.id}:cp`)},${rng})` : `SUM(${rng})`);
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        // A standard row (a curve, or even over the construction years) is read over the phase's construction years only;
        // the row's total over the years it reads sits in the Input column (2026-11-19, founder: no formula over 150).
        const k = P(ppr, c), cp = trow.standard ? w.ref(`tl:phase:${ph.id}:cp`) : '';
        const den = A(r, 2);
        w.fA({ sheet: CAPEX, row: r, col: c }, cp ? `IF(${k}>${cp},0,IFERROR(SUMIF(${hdr},${k},${rng})/${den},0))` : `IFERROR(SUMIF(${hdr},${k},${rng})/${den},0)`);
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
    // A SPEND SHARE MAY LIVE ON REVENUE (a line following collections, 2026-11-15): read it on its own sheet
    // (2026-11-18). A Capex row number alone pointed a capitalised commission at an empty Capex row.
    const spreadRef = (plot: string, lid: string, c: number): string => {
      const a = w.addr(`cxw:${plan.plotLine.get(`${plot}|${lid}`)!.spread}`);
      return a.sheet === CAPEX ? P(a.row, c) : w.refP({ sheet: a.sheet, row: a.row, col: c }, CAPEX);
    };
    const blendRow = (r: number, plots: string[], weight: (id: string) => string, lid: (id: string) => string): void => {
      const W = plots.map(weight);
      const tot = W.length > 1 ? `(${W.join('+')})` : W[0];
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        const terms = plots.map((id, i) => `${W[i]}*${spreadRef(id, lid(id), c)}`);
        w.fA({ sheet: CAPEX, row: r, col: c }, `IF(${tot}>0,(${terms.join('+')})/${tot},${spreadRef(plots[0], lid(plots[0]), c)})`);
      }
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    };
    for (const b of blends.hard) {
      if (!w.has(b.key)) return values(`the blended spend share of ${b.lid} on ${b.host} is not on the sheet`);
      blendRow(w.addr(b.key).row, b.plots, (id) => plotQty(plotLines.get(`${id}|${b.lid}`)!), () => b.lid);
    }
    // THE PLOT WEIGHTS IN THE INPUT COLUMN (2026-11-17, founder): a weight is not a total, so it is not in Total.
    const C_W = 2;
    for (const wt of blends.weights) {
      if (!w.has(wt.key)) return values('a plot\'s hard-cost weight is not on the sheet');
      // The plot's hard-cost money: each hard line's rate x the plot's quantity, spread and escalated, one row
      // per hard line (2026-11-15: short formulas), the weight their sum.
      const partKeys: string[] = [];
      for (const lid of blends.hardLines.get(wt.host) ?? []) {
        const pl = plotLines.get(`${wt.plot}|${lid}`);
        const pk = `${wt.key}|${lid}`;
        if (!w.has(pk)) continue;
        if (!pl || pl.disabled) { w.f(pk, '0', { col: C_W }); partKeys.push(pk); continue; }
        const sp = plan.plotLine.get(`${wt.plot}|${lid}`)!;
        const esc = sp.escalates ? `*SUMPRODUCT(${w.rangeA(CAPEX, spreadRow(wt.plot, lid), cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '')},${w.rangeA(CAPEX, escRow, cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '')})` : '';
        w.f(pk, `${rateRef(pl)}*${plotQty(pl)}${esc}`, { col: C_W });
        partKeys.push(pk);
      }
      const rs = partKeys.map((k) => w.addr(k).row).sort((a, b) => a - b);
      const L = colOf(C_W);
      w.f(wt.key, rs.length ? (rs.every((x, i) => i === 0 || x === rs[i - 1] + 1) ? `SUM(${L}$${rs[0]}:${L}$${rs[rs.length - 1]})` : rs.map((x) => `${L}$${x}`).join('+')) : '0', { col: C_W });
    }
    for (const b of blends.soft) {
      if (!w.has(b.key)) return values(`the blended soft-cost share on ${b.host} is not on the sheet`);
      const wRow = (id: string): string => A(w.addr(`cxhw:${b.host}:${id}`).row, C_W);
      blendRow(w.addr(b.key).row, b.plots, wRow, () => b.lids[0]);
    }

    for (const [pk, row] of rowOf) {
      const rep = plotLines.get(pk)!;
      const host = hostOfRep.get(pk)!;
      const pls = plsOf(host, rep.line.id);
      const ek = `cx1e:${host}:${rep.line.id}`;
      const S = rep.key.startsWith('cxe:') && w.has(ek) ? w.addr(ek).sheet : CAPEX;
      if (S !== CAPEX) {
        // ON REVENUE (2026-11-15, founder): rate x the line's sale value x its collections share.
        w.claim(rep.key, S, row, 1);
        const rateCell = rep.rate.kind === 'std' ? w.addr(rep.rate.key) : { sheet: INPUTS, row: rep.rate.kind === 'line' ? (firstRow.get(rep.line.id) ?? inpRow(rep.asset.id, rep.line.id)) : inpRow(rep.asset.id, rep.line.id), col: 3 };
        w.claim(rep.key.replace(/^cx[ce]:/, 'cxrate:'), rateCell.sheet, rateCell.row, rateCell.col);
        w.fA({ sheet: S, row, col: 2 }, rateRef(rep));
        w.fA({ sheet: S, row, col: C_QTY }, assetQty(host, pls));
        const use = blends.use.get(`${host}|${rep.line.id}`);
        const sp = use && w.has(use) ? w.addr(use) : undefined;
        const off = pls.every((x) => x.disabled);
        const RA = (col: number): string => w.refA({ sheet: S, row, col }, S);
        for (let t = 0; t < N; t++) {
          const c = cP(t);
          if (off || !sp) { w.valueA({ sheet: S, row, col: c }, 0); continue; }
          w.fA({ sheet: S, row, col: c }, `${RA(2)}*${RA(C_QTY)}*${w.refP({ sheet: sp.sheet, row: sp.row, col: c }, S)}`);
        }
        w.fA({ sheet: S, row, col: C_TOT }, `SUM(${w.rangeA(S, row, cP(0), cP(N - 1)).replace(/^'?[^!]+'?!/, '')})`);
        continue;
      }
      w.claim(rep.key, CAPEX, row, 1);
      const rateCell = rep.rate.kind === 'std' ? w.addr(rep.rate.key)
        : { sheet: INPUTS, row: rep.rate.kind === 'line' ? (firstRow.get(rep.line.id) ?? inpRow(rep.asset.id, rep.line.id)) : inpRow(rep.asset.id, rep.line.id), col: 3 };
      // Named apart from the row keys (cxc:<plot>:<line>), which readers find by prefix.
      w.claim(rep.key.replace(/^cx[ce]:/, 'cxrate:'), rateCell.sheet, rateCell.row, rateCell.col);
      // The rate as a number (B) and the quantity (C), read where they are typed or derived.
      w.fA({ sheet: CAPEX, row, col: 2 }, rateRef(rep));
      w.fA({ sheet: CAPEX, row, col: C_QTY }, assetQty(host, pls));
      const use = blends.use.get(`${host}|${rep.line.id}`);
      const spAddr = use && w.has(use) ? w.addr(use) : undefined;
      const spRow = spAddr?.row;
      if (pls.some((x) => x.disabled) && !pls.every((x) => x.disabled)) return values(`${rep.line.name} is switched off on some plots of ${host} and not on others`);
      const off = pls.every((x) => x.disabled);
      const esc = plan.plotLine.get(pk)?.escalates;
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        if (off || spRow === undefined) { w.valueA({ sheet: CAPEX, row, col: c }, 0); continue; }
        // Rate x quantity x the year's spend share x the year's escalation factor.
        const share = spAddr && spAddr.sheet !== CAPEX ? w.refP({ sheet: spAddr.sheet, row: spAddr.row, col: c }, CAPEX) : P(spRow, c);
        w.fA({ sheet: CAPEX, row, col: c }, `${A(row, 2)}*${A(row, C_QTY)}*${share}${esc ? `*${P(escRow, c)}` : ''}`);
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
    if (w.has('cx1e:total')) {
      const tk = w.addr('cx1e:total');
      const rows = reg.keys().filter((k) => k.startsWith('cx1e:') && k !== 'cx1e:total').map((k) => w.addr(k)).filter((a) => a.sheet === tk.sheet).map((a) => a.row).sort((x, y) => x - y);
      for (const c of [...Array.from({ length: N }, (_, t) => cP(t)), C_TOT]) {
        for (const rr of rows) w.refP({ sheet: tk.sheet, row: rr, col: c }, tk.sheet);
        const L = colOf(c);
        w.fA({ sheet: tk.sheet, row: tk.row, col: c }, rows.length ? 'SUM(' + L + '$' + rows[0] + ':' + L + '$' + rows[rows.length - 1] + ')' : '0');
      }
    }
    sumKeys('cx1:total', hosts.map((h) => `cx1sub:${h}`));

    // ── Tables 2 and 4: an asset's capex incl. and excl. its land value ──────
    const lineById = new Map(costLines.map((l) => [l.id, l] as const));
    const isInKindLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_inkind_land';
    const isCashLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_cash_land';
    const landKeys = (host: string, pred: (l: CostLine) => boolean): string[] => t1Keys(host).filter((k) => { const l = lineById.get(k.split(':')[2]); return !!l && pred(l); });
    const KP = (key: string, col: number): string => w.refP({ sheet: CAPEX, row: w.addr(key).row, col }, CAPEX);
    const phaseOfHost = (h: string): string => state.assets.find((a) => a.id === h)?.phaseId ?? '';
    // Table 2 incl. all land, Table 3 less the land in kind, Table 4 less the land VALUE lines (RETT stays in).
    for (const [pfx, less] of [['cx2', null], ['cx3', isInKindLand], ['cx4', (l: CostLine) => isLandValueLine(l)]] as const) {
      const inTable = hosts.filter((h) => w.has(`${pfx}:${h}`));
      for (const h of inTable) {
        const r = w.addr(`${pfx}:${h}`).row;
        const minus = less ? landKeys(h, less) : [];
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
    if (w.has('cx5:total:cash')) {
      // The capex summary (2026-11-15) has no per-phase land rows: its totals add Table 1's land value rows.
      sumKeys('cx5:total:cash', cashK.length ? cashK : hosts.flatMap((h) => landKeys(h, isCashLand)));
      sumKeys('cx5:total:inkind', inkK.length ? inkK : hosts.flatMap((h) => landKeys(h, isInKindLand)));
      sumKeys('cx5:total:land', ['cx5:total:cash', 'cx5:total:inkind']);
    }
    // The capex paid in cash and the development cost less the selling costs (2026-11-19): Financing links both.
    if (w.has('cx:cashCapex') && w.has('cx2:total') && w.has('cx5:total:inkind')) {
      const r0 = w.addr('cx:cashCapex').row;
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r0, col: cP(t) }, `${KP('cx2:total', cP(t))}-${KP('cx5:total:inkind', cP(t))}`);
      w.fA({ sheet: CAPEX, row: r0, col: C_TOT }, sumAcross(r0));
    }
    if (w.has('cx:tdc') && w.has('cx2:total')) {
      const comm = hosts.flatMap((h) => t1Keys(h).filter((k) => { const l = lineById.get(k.split(':')[2]); return !!l && resolveCatalogId(l) === 'commission'; }));
      const r0 = w.addr('cx:tdc').row;
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r0, col: cP(t) }, `${KP('cx2:total', cP(t))}${comm.length ? `-${sumCol(comm.map((k) => w.addr(k).row), cP(t))}` : ''}`);
      w.fA({ sheet: CAPEX, row: r0, col: C_TOT }, sumAcross(r0));
    }
    // The land-stage memo's total, and the land stage (land value + memo).
    sumKeys('cx5memo:total', phases.map((ph) => `cx5memo:${ph.id}`));
    sumKeys('cx5:stage', ['cx5:total:land', 'cx5memo:total']);

    // ── Table 6: capex by section, the line's capex incl. all land (Table 2) and excl. all land (Table 4) ──
    {
      const secOf = (h: string): string => { const a = state.assets.find((x) => x.id === h); return a ? assetCapexSection(a, project) : ''; };
      for (const [ti, pfx] of [[0, 'cx2'], [1, 'cx4']] as const) {
        const secKeys: string[] = [];
        for (const k of reg.keys().filter((x) => x.startsWith(`cx6:${ti}:`) && x !== `cx6:${ti}:total`)) {
          const sec = k.slice(`cx6:${ti}:`.length);
          sumKeys(k, hosts.filter((h) => secOf(h) === sec).map((h) => `${pfx}:${h}`));
          secKeys.push(k);
        }
        sumKeys(`cx6:${ti}:total`, secKeys);
      }
    }
    void K;

    // ── Capex by cost type (2026-11-12, founder): Table 1's rows of each type, the one rule (capexCostType) ──
    {
      const typeKeys: string[] = [];
      for (const ct of CAPEX_COST_TYPES) {
        const key = `cxty:${ct.id}`;
        if (!w.has(key)) continue;
        const parts = hosts.flatMap((h) => landKeys(h, (l) => capexCostType(l) === ct.id && !isExpensedAsIncurred(l)));
        sumKeys(key, parts);
        typeKeys.push(key);
      }
      // The land rows by cost type are Table 5's totals (cash, in-kind); RETT is its own type.
      sumKeys('cxty:landCash', ['cx5:total:cash']);
      sumKeys('cxty:landInKind', ['cx5:total:inkind']);
      const landRows = ['cxty:landCash', 'cxty:landInKind'].filter((k) => w.has(k));
      if (w.has('cxty:total') && (typeKeys.length || landRows.length)) sumKeys('cxty:total', [...landRows, ...typeKeys]);
    }

    // Revenue's selling costs are worked out on Revenue itself since 2026-11-15 (its last section, above).

    const pending = [...w.pending].filter((a) => a.startsWith(`${CAPEX}!`));
    return [{
      sheet: CAPEX, status: pending.length ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CAPEX) ?? 0, pending,
      note: 'Live: one row per cost line per asset (the rate from Inputs or the cost standards in B, the quantity from Land & Area, Revenue or the lines it selects in C, each year rate x quantity x the spend share x the escalation factor), the spend shares (one row per distinct spread; a blend only where an asset\'s plots spread a line differently), the selling and marketing expensed, and Tables 2 to 6 (incl. all land, excl. land in-kind, excl. all land, land by phase, by section).',
    }];
  },
};
