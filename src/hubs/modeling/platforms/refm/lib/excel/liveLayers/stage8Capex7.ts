/**
 * stage8Capex7.ts (2026-09-28)
 *
 * STAGE 8: CAPEX TABLE 7, LIVE. Table 7 is lib/reports/costPerSqmReport.ts on
 * the sheet: per LINE, three cost bases over three areas (7a), and for a Sell
 * line the price per sqm of NSA against them (7b). Every figure is read from
 * where the live workbook already holds it, by the report's own rules:
 *
 *   - construction (hard, soft and pre-opening) and the land stage: each cost
 *     line's amount on the Capex working sheet, filed by deriveCostStage, the
 *     resolver the engine files byStage with; marketing is in no base;
 *   - capitalised interest: the solve's per-asset rows, floored at zero a year
 *     at a time (the rule cost of sales applies to the same series);
 *   - NSA, BUA and GFA: liveAreas.ts, the one live expression of
 *     resolveAssetAreaMetrics, shared with the Summary;
 *   - GDV, area sold and GDV at the Table 5 prices: the Revenue working sheet's
 *     sale revenue, its per-row area and unit rows, and the Inputs rates.
 *
 * The cost and area figures prove themselves at build against the report
 * (their cells cache the engine's values); the interest and the sale figures
 * sit on circular or new working rows with no cached value and are proved in
 * real Excel by verify-formula-workbook B. A line whose cells are missing
 * leaves the table the platform's values, and the sheet says why.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { figureTools, liveAssetAreas, type X } from './liveAreas';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { deriveCostStage, resolveSubUnitMetric } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { buildCostPerSqmReport, COST_BASES } from '../../reports/costPerSqmReport';
import type { CostLine, SubUnit } from '../../state/module1-types';

const CAPEX = 'Capex';
const CALC = 'Capex Calc';
const AMOUNT_COL = 6; // the line amount on the Capex working sheet (stage2Capex cF)

export const stage8Capex7: LiveLayer = {
  name: 'stage 8: capex table 7',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const keys = reg.keys().filter((k) => k.startsWith('cx7a|') || k.startsWith('cx7b|'));
    if (!keys.length) return [];
    const kept = (why: string) => [{ sheet: CAPEX, status: 'partial' as const, formulas: 0, note: `Table 7 stays the platform's values: ${why}.` }];
    if (!has('fnc:main:interest')) return kept('the financing solve, which the interest comes from, is not live for this model');

    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const report = buildCostPerSqmReport(snap, raw);
    const tools = figureTools(wb, w);
    const { cellX, add, near } = tools;
    const visible = state.assets.filter((a) => a.visible !== false);
    const { perAsset, misses } = liveAssetAreas(tools, state, visible);
    const costLines = state.costLines as CostLine[];
    const subUnits = state.subUnits as SubUnit[];

    // ── Each line's figures, as formula and twin ────────────────────────────
    const problems: string[] = [];
    type Fig = { construction: X; land: X; idc: string; nsa: X; bua: X; gfa: X; gdv?: string; sold?: string; atBase?: string };
    const figs = new Map<string, Fig>();
    for (const l of report.lines) {
      const byStage = (want: (s: string) => boolean): X | null => {
        const parts: X[] = [];
        for (const id of l.memberIds) {
          for (const k of reg.keys().filter((x) => x.startsWith(`cxc:${id}:`))) {
            const line = costLines.find((c) => c.id === k.slice(`cxc:${id}:`.length));
            if (!line) return null;
            if (want(String(deriveCostStage(line)))) { const c = cellX(k, AMOUNT_COL); if (!c) return null; parts.push(c); }
          }
        }
        return add(parts);
      };
      const construction = byStage((s) => s === 'hard' || s === 'soft' || s === 'operating');
      const land = byStage((s) => s === 'land');
      const areas = l.memberIds.map((id) => perAsset.get(id));
      if (!construction || !land) { problems.push(`${l.label}: a cost line is not on the working sheet`); continue; }
      if (areas.some((a) => !a)) { problems.push(`${l.label}: an area is not live (${misses.join('; ')})`); continue; }
      const sumA = (k: 'nsa' | 'bua' | 'gfa'): X => add(areas.map((a) => a![k]));
      const nsa = sumA('nsa'), bua = sumA('bua'), gfa = sumA('gfa');
      const bad = [
        near(construction.v, l.cost.construction) ? '' : 'construction',
        near(land.v, l.land) ? '' : 'land',
        near(nsa.v, l.area.nsa) && near(bua.v, l.area.bua) && near(gfa.v, l.area.gfa) ? '' : 'areas',
      ].filter(Boolean);
      if (bad.length) { problems.push(`${l.label} (${bad.join(', ')} disagree with the report)`); continue; }
      const idcTerms = l.memberIds.filter((id) => has(`fnc:main:idc:${id}`)).flatMap((id) => {
        const a = w.addr(`fnc:main:idc:${id}`);
        return Array.from({ length: N }, (_, t) => `MAX(0,N(${w.refA({ sheet: a.sheet, row: a.row, col: 4 + t })}))`);
      });
      const fig: Fig = { construction, land, idc: idcTerms.length ? `(${idcTerms.join('+')})` : '0', nsa, bua, gfa };
      if (l.sale) {
        const gdv: string[] = [], sold: string[] = [], atBase: string[] = [];
        // The Revenue working sheet states a LINE's sale revenue once, on its lead asset
        // (stage3Revenue: rvc:<asset>:saleRev), and Table 7 is per line too.
        const revIds = l.memberIds.filter((id) => has(`rvc:${id}:saleRev`));
        if (!revIds.length) { problems.push(`${l.label}: its sale revenue is not on the Revenue working sheet`); continue; }
        for (const id of revIds) gdv.push(`N(${w.ref(`rvc:${id}:saleRev`, 3)})`);
        for (const id of l.memberIds) {
          const sell = snap.revenue.bySellAsset.get(id);
          const asset = state.assets.find((a) => a.id === id);
          if (!sell || !asset) continue;
          for (const u of subUnits.filter((s) => s.assetId === id)) {
            const rowsOf = (nm: 'area' | 'units'): string[] => reg.keys().filter((k) => k.startsWith('rvc:') && k.includes(`:${u.id}:`) && new RegExp(`:(pre|post):${nm}$`).test(k))
              .map((k) => `SUM(${w.rangeA('Revenue Calc', w.addr(k).row, 4, 4 + N - 1)})`);
            const area = rowsOf('area');
            sold.push(...area);
            const qty = resolveSubUnitMetric(u, asset) === 'units' ? rowsOf('units') : area;
            if (qty.length && has(`su:${u.id}:rate`)) atBase.push(`(${qty.join('+')})*MAX(0,N(${w.ref(`su:${u.id}:rate`)}))`);
            else if (qty.length && (u.unitPrice ?? 0) > 0) { problems.push(`${l.label}: a sub-unit's price is not on the Inputs sheet`); }
          }
        }
        fig.gdv = gdv.length ? `(${gdv.join('+')})` : '0';
        fig.sold = sold.length ? `(${sold.join('+')})` : '0';
        fig.atBase = atBase.length ? `(${atBase.join('+')})` : '0';
      }
      figs.set(l.key, fig);
    }
    if (problems.length) { w.reset(); return kept([...new Set(problems)].slice(0, 4).join('; ')); }

    // ── Writing: 7a, then 7b, cell by cell as costPerSqmTables lays them out ──
    const C_TOT = 5;
    const at = (key: string, col: number) => ({ sheet: CAPEX, row: w.addr(key).row, col });
    const perSqm = (num: string, den: string): string => `IF(${den}>0,(${num})/(${den}),"n/a")`;
    const diff = (a: string, b: string): string => `IF(AND(ISNUMBER(${a}),ISNUMBER(${b})),${a}-${b},"n/a")`;
    for (const l of report.lines) {
      const f = figs.get(l.key)!;
      const areas = [f.nsa.f, f.bua.f, f.gfa.f];
      const cost = { construction: f.construction.f, withIdc: `(${f.construction.f}+${f.idc})`, withLand: `(${f.construction.f}+${f.idc}+${f.land.f})` };
      const head = `cx7a|${l.key}|head`;
      if (has(head)) areas.forEach((a, i) => w.fA(at(head, C_TOT + 1 + i), a));
      for (const b of COST_BASES) {
        const k = `cx7a|${l.key}|${b.key}`;
        if (!has(k)) continue;
        w.fA(at(k, C_TOT), cost[b.key]);
        areas.forEach((a, i) => w.fA(at(k, C_TOT + 1 + i), perSqm(cost[b.key], a)));
      }
      if (!l.sale || !has(`cx7b|${l.key}|sold`)) continue;
      const soldK = `cx7b|${l.key}|sold`;
      w.fA(at(soldK, C_TOT), f.sold!);
      w.fA(at(soldK, C_TOT + 1), perSqm(f.atBase!, f.sold!));
      w.fA(at(soldK, C_TOT + 2), perSqm(f.gdv!, f.sold!));
      const base = w.refA(at(soldK, C_TOT + 1)), realised = w.refA(at(soldK, C_TOT + 2));
      for (const b of COST_BASES) {
        const k = `cx7b|${l.key}|${b.key}`;
        if (!has(k)) continue;
        // The cost per sqm of NSA is Table 7a's own cell for that base.
        const costCell = has(`cx7a|${l.key}|${b.key}`) ? w.refA(at(`cx7a|${l.key}|${b.key}`, C_TOT + 1)) : perSqm(cost[b.key], f.nsa.f);
        w.fA(at(k, C_TOT), costCell);
        const mine = w.refA(at(k, C_TOT));
        w.fA(at(k, C_TOT + 1), diff(base, mine));
        w.fA(at(k, C_TOT + 2), diff(realised, mine));
      }
      if (has(`cx7b|${l.key}|esc`)) w.fA(at(`cx7b|${l.key}|esc`, C_TOT + 2), diff(realised, base));
    }
    // Table 7 was the last part of the sheet that was values. The sheet is live unless
    // stage 2 left a cell waiting (its revenue-based lines, where Revenue is not live).
    const waiting = [...ctx.pending].some((a) => a.startsWith(`${CAPEX}!`) || a.startsWith(`${CALC}!`));
    return [{
      sheet: CAPEX, status: waiting ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CAPEX) ?? 0,
      note: 'Also live: Table 7 (construction, capitalised interest and land per line over its NSA, BUA and GFA, and for a Sell line the base and realised price per sqm against each), from the line amounts on the working sheet, the financing solve, the live areas and the Revenue working sheet.',
    }];
  },
};
