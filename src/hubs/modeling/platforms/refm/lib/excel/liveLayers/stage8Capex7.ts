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
import { capexCols } from '../buildModelWorkbook';
import { figureTools, liveAssetAreas, type X } from './liveAreas';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { deriveCostStage, resolveSubUnitMetric } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { buildCostPerSqmReport } from '../../reports/costPerSqmReport';
import type { CostLine, SubUnit } from '../../state/module1-types';

// BACK ON CAPEX (2026-11-19, founder: "the same summaries and per-sqm analysis as the platform's Capex results tab"):
// the Summary it moved to on 2026-11-12 was replaced by the Dashboard, which left Table 7 nowhere.
const CAPEX = 'Capex';

export const stage8Capex7: LiveLayer = {
  name: 'stage 8: capex table 7',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const keys = reg.keys().filter((k) => k.startsWith('cx7a|') || k.startsWith('cx7b|'));
    void keys.length;
    if (!keys.length) return [];
    const kept = (why: string) => { if (process.env.DEBUG7) console.log('TABLE7 KEPT', why); return [{ sheet: CAPEX, status: 'partial' as const, formulas: 0, note: `Table 7 stays the platform's values: ${why}.` }]; };
    if (!has('fnc:main:interest')) return kept('the financing solve, which the interest comes from, is not live for this model');

    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const report = buildCostPerSqmReport(snap, raw);
    const tools = figureTools(wb, w);
    const { cellX, add, near } = tools;
    const visible = state.assets.filter((a) => a.visible !== false);
    const { perAsset, misses, builtAreas } = liveAssetAreas(tools, state, visible);
    const costLines = state.costLines as CostLine[];
    const subUnits = state.subUnits as SubUnit[];

    // ── Each line's figures, as formula and twin ────────────────────────────
    const problems: string[] = [];
    type Fig = { construction: X; land: X; idc: string; nsa: X; bua: X; gfa: X; gdv?: string; sold?: string; atBase?: string; basePrice?: string };
    const figs = new Map<string, Fig>();
    for (const l of report.lines) {
      const byStage = (want: (s: string) => boolean): X | null => {
        const parts: X[] = [];
        for (const id of l.memberIds) {
          for (const k of reg.keys().filter((x) => x.startsWith(`cxc:${id}:`))) {
            const line = costLines.find((c) => c.id === k.slice(`cxc:${id}:`.length));
            if (!line) return null;
            if (want(String(deriveCostStage(line)))) { const c = cellX(k, capexCols(N).C_TOT); if (!c) return null; parts.push(c); }
          }
        }
        return add(parts);
      };
      const construction = byStage((s) => s === 'hard' || s === 'soft' || s === 'operating');
      const land = byStage((s) => s === 'land');
      if (!construction || !land) { problems.push(`${l.label}: a cost line is not on the working sheet`); continue; }
      // NSA is the line's one "NSA used" row on Land & Area where it has one (2026-10-27); then a plot needs only its
      // built areas live (2026-11-19).
      const lineNsa = has(`nsaline:${l.key}`) ? cellX(`nsaline:${l.key}`) : null;
      const areas = l.memberIds.map((id) => perAsset.get(id) ?? (lineNsa ? builtAreas.get(id) : undefined));
      if (areas.some((a) => !a)) { problems.push(`${l.label}: an area is not live (${misses.join('; ')})`); continue; }
      const sumA = (k: 'bua' | 'gfa'): X => add(areas.map((a) => a![k]));
      const nsa = lineNsa ?? add(areas.map((a) => (a as unknown as { nsa: X }).nsa)), bua = sumA('bua'), gfa = sumA('gfa');
      const bad = [
        near(construction.v, l.cost.construction) ? '' : 'construction',
        near(land.v, l.land) ? '' : 'land',
        near(nsa.v, l.area.nsa) && near(bua.v, l.area.bua) && near(gfa.v, l.area.gfa) ? '' : 'areas',
      ].filter(Boolean);
      if (bad.length) { problems.push(`${l.label} (${bad.join(', ')} disagree with the report)`); continue; }
      // A line's capitalised interest is one row its plots share (stage6Loop): each row once.
      const idcSeen = new Set<number>();
      const idcTerms = l.memberIds.filter((id) => has(`fnc:main:idc:${id}`)).filter((id) => { const r = w.addr(`fnc:main:idc:${id}`).row; if (idcSeen.has(r)) return false; idcSeen.add(r); return true; }).flatMap((id) => {
        // A plain link, as every IDC reader takes it (2026-11-19, founder C16): capitalised interest is never negative.
        return Array.from({ length: N }, (_, t) => w.per(`fnc:main:idc:${id}`, t));
      });
      const fig: Fig = { construction, land, idc: idcTerms.length ? `(${idcTerms.join('+')})` : '0', nsa, bua, gfa };
      if (l.sale) {
        const gdv: string[] = [], sold: string[] = [], atBase: string[] = [], prices: string[] = [];
        // The Revenue working sheet states a LINE's sale revenue once, on its lead asset
        // (stage3Revenue: rvc:<asset>:saleRev), and Table 7 is per line too.
        const revIds = l.memberIds.filter((id) => has(`rvc:${id}:saleRev`));
        if (!revIds.length) { problems.push(`${l.label}: its sale revenue is not on the Revenue working sheet`); continue; }
        for (const id of revIds) gdv.push(w.one(`rvc:${id}:saleRev`));
        for (const id of l.memberIds) {
          const sell = snap.revenue.bySellAsset.get(id);
          const asset = state.assets.find((a) => a.id === id);
          if (!sell || !asset) continue;
          for (const u of subUnits.filter((s) => s.assetId === id)) {
            const rowsOf = (nm: 'area' | 'units'): string[] => reg.keys().filter((k) => k.startsWith('rvc:') && k.includes(`:${u.id}:`) && new RegExp(`:(pre|post):${nm}$`).test(k))
              .map((k) => `SUM(${w.perRange(k, N)})`);
            const area = rowsOf('area');
            sold.push(...area);
            const qty = resolveSubUnitMetric(u, asset) === 'units' ? rowsOf('units') : area;
            if (qty.length && has(`su:${u.id}:rate`)) { atBase.push(`(${qty.join('+')})*${w.ref(`su:${u.id}:rate`)}`); prices.push(w.ref(`su:${u.id}:rate`)); }
            else if (qty.length && (u.unitPrice ?? 0) > 0) { problems.push(`${l.label}: a sub-unit's price is not on the Inputs sheet`); }
          }
        }
        fig.gdv = gdv.length ? `(${gdv.join('+')})` : '0';
        fig.sold = sold.length ? `(${sold.join('+')})` : '0';
        fig.atBase = atBase.length ? `(${atBase.join('+')})` : '0';
        // One priced sub-unit: its price, read where it is typed; several: their sold-weighted average.
        if (prices.length === 1) fig.basePrice = prices[0];
      }
      figs.set(l.key, fig);
    }
    if (problems.length) { w.reset(); return kept([...new Set(problems)].slice(0, 4).join('; ')); }

    // ── Writing, as the platform's Table 7 (costPerSqmTables): per line a heading row holding its NSA, GFA and BUA,
    // then each cumulative cost base, its amount and its cost per sqm of each; per Sell line the area sold, the base and
    // realised price per sqm of NSA, each base's cost and the margin at each price, and what escalation earned. ──
    const at = (key: string, col: number) => ({ sheet: w.addr(key).sheet, row: w.addr(key).row, col });
    for (const l of report.lines) {
      const f = figs.get(l.key)!;
      const hk = `cx7a|${l.key}|head`;
      if (!has(hk)) continue;
      // Areas: NSA, GFA (the platform's `bua`, areaTiers) and BUA (its `gfa`).
      w.fA(at(hk, 3), f.nsa.f); w.fA(at(hk, 4), f.bua.f); w.fA(at(hk, 5), f.gfa.f);
      const area = (col: number): string => w.refA(at(hk, col));
      let prev = '';
      for (const [base, add] of [['construction', f.construction.f], ['withIdc', f.idc], ['withLand', f.land.f]] as const) {
        const k = `cx7a|${l.key}|${base}`;
        if (!has(k)) continue;
        w.fA(at(k, 2), prev ? `${prev}+${add}` : add);
        prev = w.refA(at(k, 2));
        for (const col of [3, 4, 5]) w.fA(at(k, col), `IF(${area(col)}>0,${prev}/${area(col)},"n/a")`);
      }
      const sk = `cx7b|${l.key}|sold`;
      if (!l.sale || !has(sk)) continue;
      w.fA(at(sk, 2), f.sold!);
      const sold = w.refA(at(sk, 2));
      w.fA(at(sk, 3), `IF(${sold}>0,${f.atBase}/${sold},"n/a")`);
      w.fA(at(sk, 4), `IF(${sold}>0,${f.gdv}/${sold},"n/a")`);
      const base = w.refA(at(sk, 3)), real = w.refA(at(sk, 4));
      for (const b0 of ['construction', 'withIdc', 'withLand'] as const) {
        const k = `cx7b|${l.key}|${b0}`;
        if (!has(k)) continue;
        w.fA(at(k, 2), w.refA(at(`cx7a|${l.key}|${b0}`, 3)));
        const cost = w.refA(at(k, 2));
        w.fA(at(k, 3), `IF(AND(ISNUMBER(${base}),ISNUMBER(${cost})),${base}-${cost},"n/a")`);
        w.fA(at(k, 4), `IF(AND(ISNUMBER(${real}),ISNUMBER(${cost})),${real}-${cost},"n/a")`);
      }
      const ek = `cx7b|${l.key}|esc`;
      if (has(ek)) w.fA(at(ek, 4), `IF(AND(ISNUMBER(${real}),ISNUMBER(${base})),${real}-${base},"n/a")`);
    }
    // Table 7 was the last part of the sheet that was values. The sheet is live unless
    // stage 2 left a cell waiting (its revenue-based lines, where Revenue is not live).
    const waiting = [...ctx.pending].some((a) => a.startsWith(`${CAPEX}!`));
    return [{
      sheet: CAPEX, status: waiting ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CAPEX) ?? 0,
      note: 'Also live: Table 7 (construction, capitalised interest and land per line over its NSA, GFA and BUA, and for a Sell line the base and realised price per sqm against each), from the line amounts on the working sheet, the financing solve, the live areas and the Revenue working sheet.',
    }];
  },
};
