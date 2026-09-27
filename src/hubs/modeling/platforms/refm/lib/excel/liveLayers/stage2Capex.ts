/**
 * stage2Capex.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 2: CAPEX.
 *
 * THE ENGINE WORKS PER PLOT AND PER COST LINE (`computeAssetCost`); the Capex
 * sheet presents by LINE, a line's plots pooled. So the calculation lives on a
 * hidden working sheet, "Capex Calc", one row per plot and cost line, written
 * as the engine's own rules:
 *
 *   rate     the cost standard row the platform picked (`pickStandardRate`),
 *            read from its cell on Inputs
 *   base     rate_x_* methods: the area the Land & Area chain derives
 *            (`resolveAssetAreaMetrics`: main asset GFA, main parking and
 *            landscape on a host, retail GFA and retail parking on a strip);
 *            percent of cash / in-kind land: the plot's land value split;
 *            percent of selected lines: this plot's amounts on the lines ABOVE
 *            it that it selects (`allowedSelectedIds`, upward only)
 *   amount   max(0, rate) x base, or the percentage clamped to 0..100% x base
 *   window   the line's own, re-derived from construction years where the line
 *            follows construction (`deriveCostWindow`)
 *   spread   even over the window; the plot's own spend curve sliced to the
 *            window where the line inherits it; the land cash shape for a line
 *            following land cash; sales collections for one following them
 *            (`distribute`, `resolveLinePhasing`), placed on the project axis
 *            by `phaseLocalToProjectIndex` (period 0 of phase 1 and period 1
 *            share the first year)
 *
 * The visible sheet then sums a line's plots: Table 1 by cost line, the input
 * profile, Tables 2 to 6, the consolidated view and the check row.
 *
 * WHAT WAITS FOR STAGE 3 (Revenue), stated rather than hidden: marketing
 * charges on SALE REVENUE and follows SALES COLLECTIONS. Both sit on the
 * working sheet as the platform's values, marked pending, and every figure they
 * reach is pending too (writer.ts), so the proof knows which cells may not yet
 * follow an input. Table 7 reads capitalised interest and revenue and stays at
 * the platform's values until those stages.
 *
 * REFUSES by name, leaving Capex as values: construction cost escalation, a
 * deferred land payment, an allocated or lump-sum line, a method outside the
 * set above, a rate typed on a line or by the user (not yet shown as an input
 * here), a phase-specific or hidden standard rate, a window or curve typed on
 * one plot's override, a non-even line spread or a non-manual plot curve.
 *
 * STRUCTURAL, fixed at export: which lines exist on which plot, which lines a
 * percentage selects, which standard row a line's rate comes from, and which
 * source a line's timing follows.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { CAPEX_COLS } from '../buildModelWorkbook';
import { ARGB, NUMFMT, setInput, setLabel, fillRange } from '../styles';
import { withResolvedAssetNames, assetLabel } from '@/src/core/calculations/assetName';
import {
  computeAssetCost, resolveCostCategory, isLandValueLine, deriveCostStage, computeAssetRevenue,
} from '@/src/core/calculations';
import { assetVisibleLines, allowedSelectedIds } from '@/src/core/calculations/selectedBase';
import { isParcelDrivenLandLine, resolvePhasingSource, collectionsForAsset } from '@/src/core/calculations/capexPhasing';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { resolveSellingCostBasis, isSellingCostMethod } from '@/src/core/calculations/revenue/sellingCosts';
import { standardTypeIdFor, standardIdentity, pickStandardRate } from '../../state/costStandards';
import { deriveLineBaseId } from '../../state/module1-types';
import type { Asset, CostLine, CostOverride, Phase } from '../../state/module1-types';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { buildCapexReport, assetCapexSection } from '../../reports/capexReports';
import { poolCapexByLine, planReportLines } from '../../reports/lineRows';

const CALC = 'Capex Calc';
const SUPPORTED = new Set([
  'rate_x_main_asset_gfa', 'rate_x_parking_area', 'rate_x_landscape_area', 'rate_x_retail_gfa', 'rate_x_retail_parking_area',
  'percent_of_cash_land', 'percent_of_inkind_land', 'percent_of_selected', 'percent_of_revenue_sale',
]);
const PERCENT = (m: string): boolean => m.startsWith('percent_of_');

type Mode = 'even' | 'curve' | 'land_cash' | 'collections';
interface CalcRow {
  asset: Asset; line: CostLine; method: string; row: number; key: string;
  mode: Mode; follows: boolean; disabled: boolean;
  stdKey: string; base: { kind: 'ref'; key: string; col?: number; ifNumber?: boolean } | { kind: 'zero' } | { kind: 'selected'; ids: string[] } | { kind: 'revenue'; value: number };
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
    const { C_RATE, C_QTY, C_TOT, C_OPEN } = CAPEX_COLS;
    const cP = (t: number): number => C_OPEN + 1 + t;
    const cChk = C_OPEN + N + 1;
    const w = new LiveWriter(wb, reg, ctx.pending);

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if ((project.costEscalationPct ?? 0) !== 0) refuse.push('construction cost escalation is on');
    if ((project.financing?.parcelFunding ?? []).some((p) => p.fundingType === 'deferred_payment')) refuse.push('a plot is paid on a deferred schedule');
    const rows = project.costStandardRows ?? [];
    const assetTypes = project.assetTypes ?? [];
    const members = new Map(pooled.members);
    const hostOfAsset = new Map<string, string>();
    for (const [host, ids] of members) for (const id of ids) hostOfAsset.set(id, host);
    const calcAssets = [...members.values()].flat().map((id) => state.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);

    const noRevenueRows = (a: Asset): boolean => !(state.subUnits as Array<{ assetId: string; category?: string }>).some((u) => u.assetId === a.id && u.category !== 'Support');
    const calc: CalcRow[] = [];
    for (const a of calcAssets) {
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
        if (act && (ov!.startPeriod !== undefined || ov!.endPeriod !== undefined || ov!.distribution !== undefined)) refuse.push(`${where} has a window or curve typed for this plot`);
        // The rate: a standard row the platform picked, shown on Inputs.
        let stdKey = '';
        if (act && ov!.origin === 'standard') {
          const identity = standardIdentity(line);
          const pick = identity ? pickStandardRate(rows, typeId, identity, phase.id) : undefined;
          if (!pick) refuse.push(`${where}: no standard row found for its rate`);
          else if (typeof pick.row.byPhase?.[phase.id] === 'number') refuse.push(`${where} takes a phase-specific standard rate, shown on Inputs only as text`);
          else if (!w.has(`std:${pick.row.id}:rate`)) refuse.push(`${where} takes its rate from a standard row Inputs does not show`);
          else stdKey = `std:${pick.row.id}:rate`;
        } else if (line.isLocked === true && isLandValueLine(line) && !act) {
          stdKey = 'locked'; // the land value line: a locked 100%, not an input on the platform either
        } else if (!disabled) refuse.push(`${where} carries a rate typed on the line or for the plot, not yet an input here`);
        // The base.
        const strip = isRetailCompanion(a);
        let base: CalcRow['base'] = { kind: 'zero' };
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
            if (!isSellingCostMethod(method)) break;
            base = { kind: 'revenue', value: resolveSellingCostBasis(snap.revenue as never, a.id, method, computeAssetRevenue(a, state.subUnits), false).amount }; break;
        }
        if (base.kind === 'ref' && !w.has(base.key)) refuse.push(`${where}: its base (${base.key}) is not on Land & Area`);
        const src = isParcelDrivenLandLine(line) ? 'own' : resolvePhasingSource(line, ov);
        let mode: Mode = 'even';
        if (src === 'inherit') mode = a.capexPhasing ? 'curve' : 'even';
        else if (src === 'land_cash') mode = 'land_cash';
        else if (src === 'collections') mode = 'collections';
        else if (src !== 'own') refuse.push(`${where} follows ${src}`);
        calc.push({ asset: a, line, method, row: 0, key: `cxc:${a.id}:${line.id}`, mode, follows: line.windowFollowsConstruction === true, disabled, stdKey, base });
      }
    }
    // Every pooled line must file under one category, and the check the layout rests on.
    for (const [, ids] of members) {
      const cats = new Set(ids.map((id) => state.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a).map((a) => assetCapexSection(a, project)));
      if (cats.size > 1) refuse.push(`a line's plots file under different capex categories (${[...cats].join(', ')})`);
    }
    if (refuse.length) {
      return [{ sheet: 'Capex', status: 'values' as const, formulas: 0, note: `Capex could not be made live for this model: ${[...new Set(refuse)].join('; ')}.` }];
    }

    // ── Visible inputs the platform holds that the sheet did not print ──────
    // Appended BELOW everything on Capex, so no existing address moves.
    const cx = wb.getWorksheet('Capex')!;
    let r = cx.rowCount + 3;
    const L = Math.max(...phases.map((p) => (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) + 2));
    setLabel(cx.getCell(r, 1), 'Live model inputs: the plot spend curves and the fixed line windows the platform holds (the formulas above read them)', { bold: true });
    fillRange(cx, r, 1, r, C_OPEN + L - 1, ARGB.subtotal);
    r += 1;
    setLabel(cx.getCell(r, 1), 'A curve is typed by period P0, P1, ... of its phase; a line that inherits it is spread by the curve sliced to its own window. A window is a line\'s start and end period where it does not follow the construction years.');
    cx.getCell(r, 1).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 2;
    for (let i = 0; i < L; i++) { const h = cx.getCell(r, C_OPEN + i); h.value = `P${i}`; h.font = { name: 'Calibri', size: 9, bold: true }; h.alignment = { horizontal: 'right' }; }
    setLabel(cx.getCell(r, C_RATE), 'Start', { bold: true }); setLabel(cx.getCell(r, C_QTY), 'End', { bold: true });
    r += 1;
    const ctxNames = { parcels: state.parcels, phases: state.phases };
    for (const a of calcAssets) {
      if (!a.capexPhasing) continue;
      setLabel(cx.getCell(r, 1), `Spend curve: ${assetLabel(a, ctxNames)}`, { indent: 1 });
      const dist = a.capexPhasing.distribution ?? [];
      for (let i = 0; i < L; i++) if (typeof dist[i] === 'number') setInput(cx.getCell(r, C_OPEN + i), dist[i], NUMFMT.rate);
      w.claim(`cxcurve:${a.id}`, 'Capex', r, 1);
      r += 1;
    }
    const fixedLines = [...new Set(calc.filter((c) => !c.follows).map((c) => c.line))];
    for (const line of fixedLines) {
      const ph = phases.find((p) => p.id === line.phaseId);
      setLabel(cx.getCell(r, 1), `Window: ${line.name}${phases.length > 1 && ph ? `, ${ph.name}` : ''}`, { indent: 1 });
      setInput(cx.getCell(r, C_RATE), line.startPeriod, NUMFMT.int);
      setInput(cx.getCell(r, C_QTY), line.endPeriod, NUMFMT.int);
      w.claim(`cxwin:${line.id}`, 'Capex', r, 1);
      r += 1;
    }

    // ── The working sheet ────────────────────────────────────────────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    const cD = 4, cE = 5, cF = 6, cG = 7, cH = 8, cI = 9, cW = 10, cPr = cW + L;
    const wCol = (i: number): number => cW + i;
    const pCol = (t: number): number => cPr + t;
    cs.getCell(1, 1).value = 'Capex working sheet: one row per plot and cost line, the engine\'s own rules. Hidden; the Capex sheet sums a line\'s plots from here. Values marked pending belong to a stage not yet live.';
    let cr = 3;
    for (const [c, h] of [[1, 'Plot'], [2, 'Cost line'], [3, 'Method'], [cD, 'Rate'], [cE, 'Base'], [cF, 'Amount'], [cG, 'Start'], [cH, 'End'], [cI, 'Shape sum']] as Array<[number, string]>) cs.getCell(cr, c).value = h;
    for (let i = 0; i < L; i++) cs.getCell(cr, wCol(i)).value = `W${i}`;
    for (let t = 0; t < N; t++) cs.getCell(cr, pCol(t)).value = `Year ${t + 1}`;
    cr += 1;
    // Phase offsets on the project axis.
    for (const ph of phases) {
      cs.getCell(cr, 1).value = `Phase: ${ph.name}`;
      w.claim(`cxc:ph:${ph.id}`, CALC, cr, 1);
      w.fA({ sheet: CALC, row: cr, col: 2 }, `${w.ref(`phase:${ph.id}:cp`)}`, { cached: ph.constructionPeriods });
      w.fA({ sheet: CALC, row: cr, col: 3 }, `MAX(0,YEAR(${w.ref(`phase:${ph.id}:start`)})-${w.ref('project:axisYear')})`, { cached: Math.max(0, new Date(ph.startDate as string).getUTCFullYear() - snap.projectStartYear) });
      cr += 1;
    }
    // Sales collections, phase-local, for each plot with a line that follows them (PENDING: Revenue).
    const collRow = new Map<string, number>();
    for (const a of new Set(calc.filter((c) => c.mode === 'collections').map((c) => c.asset))) {
      const phase = phases.find((p) => p.id === a.phaseId)!;
      const series = collectionsForAsset(snap.revenue as never, a.id, phase, snap.projectStartYear);
      if (!series) continue;
      cs.getCell(cr, 1).value = `Sales collections: ${a.name} (from Revenue, stage 3)`;
      if (w.has(`rvc:${a.id}:cash`)) {
        // LIVE once Revenue is (stage 3): the asset's cash collected, placed phase-local
        // (projectAxisToPhaseLocal: local 0 is nothing, local i is axis year off + i - 1,
        // and only the phase's own cp + op + 2 slots).
        const cashRow = w.addr(`rvc:${a.id}:cash`).row;
        const phRow = w.addr(`cxc:ph:${phase.id}`).row;
        for (let i = 0; i < L; i++) {
          if (i === 0) { w.valueA({ sheet: CALC, row: cr, col: wCol(i) }, 0); continue; }
          const off = w.refA({ sheet: CALC, row: phRow, col: 3 });
          const k = `(${off}+${i}-1)`;
          const slots = `(MAX(0,${w.ref(`phase:${phase.id}:cp`)})+MAX(0,${w.ref(`phase:${phase.id}:op`)})+2)`;
          w.fA({ sheet: CALC, row: cr, col: wCol(i) }, `IF(AND(${i}<${slots},${k}>=0,${k}<=${N - 1}),INDEX(${w.rangeA('Revenue Calc', cashRow, 4, 4 + N - 1)},1,${k}+1),0)`, { cached: series[i] ?? 0 });
        }
      } else {
        // A plot with no revenue rows collects nothing by structure; anything else waits for Revenue.
        for (let i = 0; i < L; i++) w.valueA({ sheet: CALC, row: cr, col: wCol(i) }, series[i] ?? 0, { pending: !noRevenueRows(a) });
      }
      collRow.set(a.id, cr);
      cr += 1;
    }
    cr += 1;
    for (const c of calc) { c.row = cr; w.claim(c.key, CALC, cr, 1); cr += 1; }
    const rowOf = new Map(calc.map((c) => [`${c.asset.id}:${c.line.id}`, c] as const));

    // The engine's figures, to cache each formula with the platform's value.
    const bdOf = new Map<string, ReturnType<typeof computeAssetCost>>();
    for (const a of calcAssets) {
      const phase = phases.find((p) => p.id === a.phaseId)!;
      bdOf.set(a.id, computeAssetCost({
        asset: a, project, phase, parcels: state.parcels, assets: state.assets, subUnits: state.subUnits, costLines, costOverrides: overrides,
        landAllocationMode: state.landAllocationMode, parcelFunding: project.financing?.parcelFunding,
        collectionsPerPeriod: collectionsForAsset(snap.revenue as never, a.id, phase, snap.projectStartYear), revenue: snap.revenue as never,
      }));
    }

    const A = (row: number, col: number) => ({ sheet: CALC, row, col });
    for (const c of calc) {
      const { row } = c;
      const bd = bdOf.get(c.asset.id)!;
      const amount = bd.byLineId[c.line.id] ?? 0;
      const phase = phases.find((p) => p.id === c.asset.phaseId)!;
      cs.getCell(row, 1).value = c.asset.name; cs.getCell(row, 2).value = c.line.id; cs.getCell(row, 3).value = c.method;
      // Rate.
      if (c.stdKey === 'locked') w.valueA(A(row, cD), Math.max(0, Math.min(100, c.line.value)) / 100, { numFmt: NUMFMT.pct2 });
      else if (c.stdKey) w.fA(A(row, cD), w.ref(c.stdKey));
      // Base.
      const b = c.base;
      if (b.kind === 'ref') {
        const ref = w.ref(b.key, b.col);
        w.fA(A(row, cE), b.ifNumber ? `IF(ISNUMBER(${ref}),${ref},0)` : `N(${ref})`);
      } else if (b.kind === 'selected') {
        const parts = b.ids.map((id) => rowOf.get(`${c.asset.id}:${id}`)).filter((x): x is CalcRow => !!x).map((x) => w.refA(A(x.row, cF)));
        w.fA(A(row, cE), parts.length ? parts.join('+') : '0');
      } else if (b.kind === 'revenue') {
        // LIVE once Revenue is (stage 3): the asset's sale revenue over the hold.
        if (w.has(`rvc:${c.asset.id}:saleRev`)) w.fA(A(row, cE), w.ref(`rvc:${c.asset.id}:saleRev`, 3), { cached: b.value });
        // A plot with no revenue rows sells nothing: its base is zero by structure, not waiting on anything.
        else if (noRevenueRows(c.asset)) w.valueA(A(row, cE), 0);
        else w.valueA(A(row, cE), b.value, { pending: true });
      } else w.valueA(A(row, cE), 0);
      // Amount.
      const D = w.refA(A(row, cD)), E = w.refA(A(row, cE));
      w.fA(A(row, cF), c.disabled ? '0' : PERCENT(c.method) ? `MIN(MAX(${D},0),1)*${E}` : `MAX(0,${D})*${E}`, { cached: amount });
      // Window: the line's own, derived from construction years where it follows them.
      if (c.follows) {
        const cp = `MAX(1,${w.ref(`phase:${phase.id}:cp`)})`;
        const baseId = deriveLineBaseId(c.line.id);
        const start = baseId === 'land-cash' || baseId === 'land-inkind' || baseId === 'rett' ? '0'
          : baseId === 'landscaping' || baseId === 'marketing' || baseId === 'commission' ? `MAX(1,INT(${cp}/2))`
            : baseId === 'pre-operating' ? `MAX(1,${cp}-6)` : '1';
        w.fA(A(row, cG), start, { cached: c.line.startPeriod });
        w.fA(A(row, cH), start === '0' ? '0' : `MAX(${w.refA(A(row, cG))},MAX(1,${w.ref(`phase:${phase.id}:cp`)}))`, { cached: c.line.endPeriod });
      } else {
        w.fA(A(row, cG), w.ref(`cxwin:${c.line.id}`, C_RATE), { cached: c.line.startPeriod });
        w.fA(A(row, cH), w.ref(`cxwin:${c.line.id}`, C_QTY), { cached: c.line.endPeriod });
      }
      // Weights over the phase's local periods.
      const G = (): string => w.refA(A(row, cG)), H = (): string => w.refA(A(row, cH));
      const even = (i: number): string => `IF(AND(${i}>=${G()},${i}<=MAX(${G()},${H()})),1/(MAX(${G()},${H()})-${G()}+1),0)`;
      const shapeCached = (i: number): number => {
        const per = bd.perLinePerPeriod[c.line.id];
        return amount !== 0 && per ? (per[i] ?? 0) / amount : 0;
      };
      if (c.mode === 'curve') {
        const cv = w.addr(`cxcurve:${c.asset.id}`);
        const rng = w.rangeA('Capex', cv.row, C_OPEN, C_OPEN + L - 1);
        w.fA(A(row, cI), `SUMPRODUCT((COLUMN(${rng})-${C_OPEN}>=${G()})*(COLUMN(${rng})-${C_OPEN}<=${H()})*${rng})`);
        for (let i = 0; i < L; i++) {
          const cell = w.refA({ sheet: 'Capex', row: cv.row, col: C_OPEN + i });
          w.fA(A(row, wCol(i)), `IF(${w.refA(A(row, cI))}>0,IF(AND(${i}>=${G()},${i}<=${H()}),MAX(0,N(${cell}))/${w.refA(A(row, cI))},0),${even(i)})`, { cached: shapeCached(i) });
        }
      } else if (c.mode === 'land_cash') {
        const lc = calc.filter((x) => x.asset.id === c.asset.id && isParcelDrivenLandLine(x.line) && x.method === 'percent_of_cash_land');
        w.fA(A(row, cI), lc.length ? lc.map((x) => `SUM(${w.rangeA(CALC, x.row, wCol(0), wCol(L - 1))})`).join('+') : '0');
        for (let i = 0; i < L; i++) {
          const s = lc.length ? lc.map((x) => w.refA(A(x.row, wCol(i)))).join('+') : '0';
          w.fA(A(row, wCol(i)), `IF(${w.refA(A(row, cI))}>0,(${s})/${w.refA(A(row, cI))},${even(i)})`, { cached: shapeCached(i) });
        }
      } else if (c.mode === 'collections' && collRow.has(c.asset.id)) {
        const cr0 = collRow.get(c.asset.id)!;
        w.fA(A(row, cI), `SUMIF(${w.rangeA(CALC, cr0, wCol(0), wCol(L - 1))},">0")`);
        for (let i = 0; i < L; i++) {
          w.fA(A(row, wCol(i)), `IF(${w.refA(A(row, cI))}>0,MAX(0,${w.refA(A(cr0, wCol(i)))})/${w.refA(A(row, cI))},${even(i)})`, { cached: shapeCached(i) });
        }
      } else {
        for (let i = 0; i < L; i++) w.fA(A(row, wCol(i)), even(i), { cached: shapeCached(i) });
      }
      // On the project axis (phaseLocalToProjectIndex): local 0 lands in the year
      // before the phase (never before the first), local i >= 1 in year off + i - 1.
      // References are made INSIDE the loop: each formula must record what it reads (writer.ts).
      const phRow = w.addr(`cxc:ph:${phase.id}`).row;
      for (let t = 0; t < N; t++) {
        const offRef = w.refA(A(phRow, 3));
        const wr = w.rangeA(CALC, row, wCol(0), wCol(L - 1));
        const Fr = w.refA(A(row, cF)), W0 = w.refA(A(row, wCol(0)));
        w.fA(A(row, pCol(t)), `${Fr}*(IF(${t}=MAX(0,${offRef}-1),${W0},0)+IF(AND(${t}-${offRef}+1>=1,${t}-${offRef}+1<=${L - 1}),INDEX(${wr},1,${t}-${offRef}+2),0))`,
          { cached: projectedCached(bd.perLinePerPeriod[c.line.id], Math.max(0, new Date(phase.startDate as string).getUTCFullYear() - snap.projectStartYear), t) });
      }
    }
    for (let col = 1; col <= pCol(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 28 : 14;

    // ── The visible Capex sheet, by line ─────────────────────────────────────
    // Header dates follow the Timeline.
    const hdr = w.addr('cx:hdr');
    for (let c = C_OPEN; c <= C_OPEN + N; c++) if (w.has(`tl:year:${c - 1}`)) w.fA({ sheet: 'Capex', row: hdr.row, col: c }, w.ref(`tl:year:${c - 1}`));
    const memberRows = (host: string, lineId: string): CalcRow[] => (members.get(host) ?? [host]).map((id) => rowOf.get(`${id}:${lineId}`)).filter((x): x is CalcRow => !!x);
    const refCx = (key: string, col: number): string => w.ref(key, col);
    const lineById = new Map(costLines.map((l) => [l.id, l] as const));
    const hostLines = new Map<string, string[]>();
    for (const m of pooled.report.inputAssets) hostLines.set(m.assetId, m.lines.map((l) => l.id));

    for (const [host, lineIds] of hostLines) {
      const t1keys: string[] = [];
      for (const lid of lineIds) {
        const k1 = `cx1:${host}:${lid}`;
        if (!w.has(k1)) continue;
        t1keys.push(k1);
        const ms = memberRows(host, lid);
        // Rate: the plots' shared rate, else the pooled one (amount over the summed quantities).
        const rates = ms.map((x) => w.refA(A(x.row, cD)));
        if (rates.length === 1) w.f(k1, rates[0], { col: C_RATE });
        else if (rates.length > 1) {
          const q = ms.map((x) => `IF(${w.refA(A(x.row, cD))}<>0,${w.refA(A(x.row, cF))}/${w.refA(A(x.row, cD))},0)`).join('+');
          const tot = ms.map((x) => w.refA(A(x.row, cF))).join('+');
          w.f(k1, `IF(AND(${rates.slice(1).map((x) => `${x}=${rates[0]}`).join(',')}),${rates[0]},IF((${q})<>0,(${tot})/(${q}),${rates[0]}))`, { col: C_RATE });
        }
        w.f(k1, ms.length ? ms.map((x) => w.refA(A(x.row, cF))).join('+') : '0', { col: C_TOT });
        w.f(k1, `IF(${refCx(k1, C_RATE)}<>0,${refCx(k1, C_TOT)}/${refCx(k1, C_RATE)},0)`, { col: C_QTY });
        for (let t = 0; t < N; t++) w.f(k1, ms.length ? ms.map((x) => w.refA(A(x.row, pCol(t)))).join('+') : '0', { col: cP(t) });
        // The input row above: the rate and the resolved profile.
        const ki = `cxin:${host}:${lid}`;
        if (w.has(ki)) {
          w.f(ki, refCx(k1, C_RATE), { col: C_RATE });
          for (let t = 0; t < N; t++) w.f(ki, `IF(${refCx(k1, C_TOT)}=0,0,${refCx(k1, cP(t))}/${refCx(k1, C_TOT)})`, { col: cP(t) });
          w.f(ki, `SUM(${w.rangeA('Capex', w.addr(ki).row, cP(0), cP(N - 1))})`, { col: C_TOT });
          w.f(ki, `IF(ABS(${refCx(ki, C_TOT)}-IF(${refCx(k1, C_TOT)}<>0,1,0))<=0.0001,"OK","CHECK")`, { col: cChk });
        }
      }
      const ks = `cx1sub:${host}`;
      if (w.has(ks)) {
        for (let t = 0; t < N; t++) w.f(ks, t1keys.length ? t1keys.map((k) => refCx(k, cP(t))).join('+') : '0', { col: cP(t) });
        w.f(ks, t1keys.length ? t1keys.map((k) => refCx(k, C_TOT)).join('+') : '0', { col: C_TOT });
      }
    }
    const hosts = [...hostLines.keys()].filter((h) => w.has(`cx1sub:${h}`));
    for (let t = 0; t < N; t++) w.f('cx1:total', hosts.map((h) => refCx(`cx1sub:${h}`, cP(t))).join('+'), { col: cP(t) });
    w.f('cx1:total', `SUM(${w.rangeA('Capex', w.addr('cx1:total').row, cP(0), cP(N - 1))})`, { col: C_TOT });

    // A line's series, per period: incl, excl in-kind land, excl all land value.
    const landRows = (host: string, pred: (l: CostLine) => boolean): string[] => (hostLines.get(host) ?? [])
      .filter((lid) => { const l = lineById.get(lid); return !!l && pred(l) && w.has(`cx1:${host}:${lid}`); })
      .map((lid) => `cx1:${host}:${lid}`);
    const isInKindLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_inkind_land';
    const seriesTerm = (host: string, kind: 'incl' | 'exclInKind' | 'exclAll', t: number): string => {
      const minus = kind === 'incl' ? [] : landRows(host, kind === 'exclInKind' ? isInKindLand : (l) => isLandValueLine(l));
      return `(${refCx(`cx1sub:${host}`, cP(t))}${minus.map((k) => `-${refCx(k, cP(t))}`).join('')})`;
    };
    const phaseOfHost = (h: string): string => state.assets.find((a) => a.id === h)?.phaseId ?? '';
    for (const [pfx, kind] of [['cx2', 'incl'], ['cx3', 'exclInKind'], ['cx4', 'exclAll']] as const) {
      const inTable = hosts.filter((h) => w.has(`${pfx}:${h}`));
      for (const h of inTable) {
        for (let t = 0; t < N; t++) w.f(`${pfx}:${h}`, seriesTerm(h, kind, t), { col: cP(t) });
        w.f(`${pfx}:${h}`, `SUM(${w.rangeA('Capex', w.addr(`${pfx}:${h}`).row, cP(0), cP(N - 1))})`, { col: C_TOT });
      }
      for (const ph of phases) {
        const k = `${pfx}sub:${ph.id}`; if (!w.has(k)) continue;
        const hs = inTable.filter((h) => phaseOfHost(h) === ph.id);
        for (let t = 0; t < N; t++) w.f(k, hs.length ? hs.map((h) => refCx(`${pfx}:${h}`, cP(t))).join('+') : '0', { col: cP(t) });
        w.f(k, `SUM(${w.rangeA('Capex', w.addr(k).row, cP(0), cP(N - 1))})`, { col: C_TOT });
      }
      const kt = `${pfx}:total`;
      for (let t = 0; t < N; t++) w.f(kt, inTable.length ? inTable.map((h) => refCx(`${pfx}:${h}`, cP(t))).join('+') : '0', { col: cP(t) });
      w.f(kt, `SUM(${w.rangeA('Capex', w.addr(kt).row, cP(0), cP(N - 1))})`, { col: C_TOT });
    }

    // Table 5: land cash and in-kind by phase, and the memo of the rest of the land stage.
    const byPhaseRows = (phId: string, pred: (l: CostLine) => boolean): string[] =>
      hosts.filter((h) => phaseOfHost(h) === phId).flatMap((h) => landRows(h, pred));
    const isCashLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_cash_land';
    const isMemo = (l: CostLine): boolean => deriveCostStage(l) === 'land' && !isLandValueLine(l);
    const sumRows = (key: string, rowsK: string[]): void => {
      for (let t = 0; t < N; t++) w.f(key, rowsK.length ? rowsK.map((k) => refCx(k, cP(t))).join('+') : '0', { col: cP(t) });
      w.f(key, `SUM(${w.rangeA('Capex', w.addr(key).row, cP(0), cP(N - 1))})`, { col: C_TOT });
    };
    const cashK: string[] = [], inkK: string[] = [], memoK: string[] = [];
    for (const ph of phases) {
      if (w.has(`cx5:${ph.id}:cash`)) { sumRows(`cx5:${ph.id}:cash`, byPhaseRows(ph.id, isCashLand)); cashK.push(`cx5:${ph.id}:cash`); }
      if (w.has(`cx5:${ph.id}:inkind`)) { sumRows(`cx5:${ph.id}:inkind`, byPhaseRows(ph.id, isInKindLand)); inkK.push(`cx5:${ph.id}:inkind`); }
      if (w.has(`cx5:${ph.id}:sub`)) sumRows(`cx5:${ph.id}:sub`, [`cx5:${ph.id}:cash`, `cx5:${ph.id}:inkind`].filter((k) => w.has(k)));
      if (w.has(`cx5memo:${ph.id}`)) { sumRows(`cx5memo:${ph.id}`, byPhaseRows(ph.id, isMemo)); memoK.push(`cx5memo:${ph.id}`); }
    }
    if (w.has('cx5:total:cash')) {
      sumRows('cx5:total:cash', cashK); sumRows('cx5:total:inkind', inkK); sumRows('cx5:total:land', ['cx5:total:cash', 'cx5:total:inkind']);
    }
    if (w.has('cx5memo:total')) { sumRows('cx5memo:total', memoK); sumRows('cx5:stage', ['cx5:total:land', 'cx5memo:total']); }

    // Table 6: by category, incl all land and excl total land.
    const catOf = (h: string): string => assetCapexSection(state.assets.find((a) => a.id === h)!, project);
    for (const ti of [0, 1]) {
      const catKeys: string[] = [];
      for (const key of reg.keys().filter((k) => k.startsWith(`cx6:${ti}:`) && k !== `cx6:${ti}:total`)) {
        const label = key.slice(`cx6:${ti}:`.length);
        const hs = hosts.filter((h) => catOf(h) === label);
        for (let t = 0; t < N; t++) w.f(key, hs.length ? hs.map((h) => seriesTerm(h, ti === 0 ? 'incl' : 'exclAll', t)).join('+') : '0', { col: cP(t) });
        w.f(key, `SUM(${w.rangeA('Capex', w.addr(key).row, cP(0), cP(N - 1))})`, { col: C_TOT });
        catKeys.push(key);
      }
      if (w.has(`cx6:${ti}:total`)) sumRows(`cx6:${ti}:total`, catKeys);
    }

    // The consolidated view: one row per line, the stage columns summed from Table 1.
    const treatIds = new Set(capex.treatment.map((t) => t.id));
    const stageCols: Array<[string, number]> = [['land', C_TOT], ['hard', C_OPEN], ['soft', C_OPEN + 1], ['marketing', C_OPEN + 2], ['operating', C_OPEN + 3]];
    const cTotalCons = C_OPEN + 4;
    const consKeys: string[] = [];
    for (const pl of planReportLines(state, (a) => treatIds.has(a.id))) {
      const key = `cxcons:${pl.key}`; if (!w.has(key)) continue;
      const host = pl.assetIds.find((id) => hostLines.has(id)) ?? hostOfAsset.get(pl.assetIds[0]);
      if (!host) continue;
      consKeys.push(key);
      for (const [stage, col] of stageCols) {
        const ks = (hostLines.get(host) ?? []).filter((lid) => { const l = lineById.get(lid); return !!l && deriveCostStage(l) === stage && w.has(`cx1:${host}:${lid}`); });
        w.f(key, ks.length ? ks.map((lid) => refCx(`cx1:${host}:${lid}`, C_TOT)).join('+') : '0', { col });
      }
      w.f(key, stageCols.map(([, col]) => refCx(key, col)).join('+'), { col: cTotalCons });
    }
    if (w.has('cxcons:total')) {
      for (const [, col] of [...stageCols, ['total', cTotalCons] as [string, number]]) w.f('cxcons:total', consKeys.length ? consKeys.map((k) => refCx(k, col)).join('+') : '0', { col });
      const tie = w.addr('cxcons:tie');
      const tot = refCx('cxcons:total', cTotalCons), proj = refCx('cx1:total', C_TOT);
      w.fA(tie, `IF(ABS(${tot}-${proj})<0.005,"Ties to the per-asset total: "&TEXT(${proj},"#,##0.00")&".","Does NOT tie to the per-asset total ("&TEXT(${proj},"#,##0.00")&"), out by "&TEXT(${tot}-${proj},"#,##0.00")&". Treat the per-asset tables as authoritative.")`);
    }

    // The check row: every cost line total summed.
    const allT1 = [...hostLines].flatMap(([h, lids]) => lids.map((lid) => `cx1:${h}:${lid}`)).filter((k) => w.has(k));
    w.f('cx:check', allT1.map((k) => refCx(k, C_TOT)).join('+'));

    const pending = [...w.pending];
    // Marketing reads Revenue: live when the Revenue layer is (it runs first), the platform's values otherwise.
    const sellingRows = calc.filter((c) => c.base.kind === 'revenue');
    const revenueLive = sellingRows.every((c) => w.has(`rvc:${c.asset.id}:saleRev`) || noRevenueRows(c.asset));
    const revenueNote = revenueLive
      ? 'Marketing charges on the sale revenue and follows the sales collections the Revenue sheet computes, so it is live too.'
      : 'Waiting for Revenue: marketing charges on sale revenue and follows sales collections, which the working sheet holds as the platform\'s values, so marketing and the totals that include it do not yet follow an input that moves revenue.';
    return [
      { sheet: 'Capex', status: 'partial' as const, formulas: w.formulas.get('Capex') ?? 0, pending,
        note: `Live on this sheet: every cost line's rate (the cost standards on Inputs), base (the Land & Area areas and land values), amount, window and spread, Tables 1 to 6, the consolidated view and the check row, computed per plot on a hidden working sheet (Capex Calc) and summed by line. ${revenueNote} Table 7 reads capitalised interest and revenue and stays at the platform\'s values until those stages. The plot spend curves and fixed line windows are inputs listed at the foot of the sheet.` },
      { sheet: CALC, status: 'partial' as const, formulas: w.formulas.get(CALC) ?? 0, pending: [], note: 'Working sheet for Capex.' },
    ];
  },
};

/** The engine's phase-local line schedule placed on the project axis, for a cached value. */
function projectedCached(per: number[] | undefined, off: number, t: number): number {
  if (!per) return 0;
  let v = 0;
  for (let i = 0; i < per.length; i++) {
    const idx = i === 0 ? Math.max(0, off - 1) : off + i - 1;
    if (idx === t) v += per[i] ?? 0;
  }
  return v;
}

