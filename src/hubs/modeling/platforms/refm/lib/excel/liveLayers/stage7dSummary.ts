/**
 * stage7dSummary.ts (2026-09-28)
 *
 * STAGE 7c, THE SUMMARY, LIVE. The Summary is the platform's Project Overview
 * (lib/reports/overviewReport.ts), words and all. Every figure on it is now text
 * over the live cells that already hold the quantity, by the overview's own rules:
 *
 *   - the areas per asset through resolveAssetAreaMetrics: land from Land & Area,
 *     Total GFA (platform BUA) as the chain's total GFA less the retail its strip
 *     carries, Total BUA (platform GFA) as that plus the asset's own parking, a
 *     strip's figures from its companion row, and NET SALEABLE AREA FROM THE
 *     "NSA used" CELL ON INPUTS TABLE 2, the larger of the sub-units' area and the
 *     Stated NSA (founder, 2026-09-28: a summary whose areas do not move when the
 *     inputs do is the most confusing thing the workbook could do);
 *   - units, keys and leasable area from the Table 5 rows, by the revenue
 *     resolvers' rules; the by-type rows through overviewTypeOf, the ONE filing rule;
 *   - money from the live Sources and Uses, P&L, Capex, Financing working sheet,
 *     exit working and balance sheet, and the Returns cards where the Summary
 *     prints the same words;
 *   - the headline pairs from the Checks sheet's numeric IRR and MOIC.
 *
 * EVERY FIGURE PROVES ITSELF BEFORE IT IS WRITTEN: each is built twice, as the
 * formula and as the same arithmetic over the platform values of the cells it
 * reads, and the second must equal the overview's own number. One that does
 * not stays the platform's value and the sheet names it, so this layer cannot
 * publish a formula that disagrees with the platform on the model it exports.
 *
 * What stays as of export, and says so: the key facts that are labels (date,
 * currency, location, funding method), the horizon length, the number of
 * phases and lines, and which rows the tables have and their order.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { moneyT } from './excelText';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { resolveAssetAreaMetrics, computeAssetUnitCount } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../../returns-resolvers';
import { resolveAssetKeys, resolveAssetLeasableSqm } from '../../revenue-resolvers';
import { buildOverviewReport, overviewTypeOf } from '../../reports/overviewReport';
import { fundingChartPoints } from '../../portfolio/fundingSeries';
import type { SubUnit } from '../../state/module1-types';

const SUM = 'Summary';

/** A figure twice: the Excel formula, and its value over the platform's cells. */
interface X { f: string; v: number }

export const stage7dSummary: LiveLayer = {
  name: 'stage 7c: the summary',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const values = (note: string) => [{ sheet: SUM, status: 'values' as const, formulas: 0, note }];
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    let rs: ReturnType<typeof computeReturnsSnapshot>;
    try { rs = computeReturnsSnapshot(snap, state.project); } catch { return values('The Summary stays the platform\'s values: the returns engine could not compute on this model.'); }
    const ov = buildOverviewReport(snap, rs, state);
    const { OPEN_COL, TOTAL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const cur = state.project.currency || 'SAR';
    const visible = state.assets.filter((a) => a.visible !== false);

    const isFormula = (sheet: string, row: number, col: number): boolean => {
      const v = wb.getWorksheet(sheet)?.findRow(row)?.findCell(col)?.value as unknown;
      return !!v && typeof v === 'object' && 'formula' in (v as object);
    };
    const pv = (sheet: string, row: number, col: number): number => {
      const x = w.platformValue({ sheet, row, col });
      if (typeof x === 'number') return x;
      // A date cell caches a Date, which Excel reads as its serial day number.
      const raw = wb.getWorksheet(sheet)?.findRow(row)?.findCell(col)?.value as unknown;
      const d = raw instanceof Date ? raw : raw && typeof raw === 'object' && (raw as { result?: unknown }).result instanceof Date ? (raw as { result: Date }).result : null;
      return d ? Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000) : 0;
    };
    // A cell as a figure: N() so a "-" reads as nothing, the way the platform reads an absent value.
    const cellX = (key: string, col?: number): X | null => {
      if (!has(key)) return null;
      const a = w.addr(key, col);
      return { f: `N(${w.refA(a)})`, v: pv(a.sheet, a.row, a.col) };
    };
    const add = (xs: X[]): X => ({ f: xs.length ? `(${xs.map((x) => x.f).join('+')})` : '0', v: xs.reduce((s, x) => s + x.v, 0) });
    const all = <T>(xs: Array<T | null>): T[] | null => (xs.every((x) => x !== null) ? (xs as T[]) : null);
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.005, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));

    // ── Per asset: the area figures, each proved against the platform's rule ──
    type Row = { land: X; landValue: X; gfa: X; bua: X; nsa: X; units: X; keys: X; leasable: X };
    const perAsset = new Map<string, Row>();
    const areaMisses: string[] = [];
    const subUnits = state.subUnits as SubUnit[];
    const NSA_CATS = new Set(['Sellable', 'Operable', 'Leasable']);
    for (const a of visible) {
      const m = resolveAssetAreaMetrics(a, state.project, state.parcels, visible, subUnits, state.landAllocationMode);
      const land = cellX(`land:${a.id}:sqm`), landValue = cellX(`land:${a.id}:value`);
      let bua: X | null = null, gfa: X | null = null, nsa: X | null = null;
      const rows = subUnits.filter((u) => u.assetId === a.id && u.category !== 'Support');
      const su = (u: SubUnit, k: 'area' | 'units'): X | null => cellX(`su:${u.id}:${k}`);
      if (isRetailCompanion(a)) {
        const cc = (k: string): X | null => cellX(`chaincomp:${a.name}:${k}`);
        const tg = cc('tg'), tb = cc('bua');
        if (tg && tb) {
          bua = tg; gfa = tb;
          // The strip's stated NSA is stamped from the chain on every pass (makeRetailCompanionAsset), so it is the chain's cell.
          const t5 = all(rows.filter((u) => NSA_CATS.has(u.category)).map((u) => su(u, 'area')));
          if (t5) { const s = add(t5); nsa = { f: `MAX(${s.f},${tg.f})`, v: Math.max(s.v, tg.v) }; }
        }
      } else if (Number.isFinite(a.derivedAreas?.totalGfaSqm)) {
        const ch = (k: string): X | null => cellX(`chain:${a.id}:${k}`);
        const tg = ch('tg'), ret = ch('ret'), park = ch('parea');
        if (tg && ret && park) {
          bua = { f: `MAX(0,${tg.f}-${ret.f})`, v: Math.max(0, tg.v - ret.v) };
          gfa = { f: `(${bua.f}+${park.f})`, v: bua.v + park.v };
        }
        nsa = cellX(`entry:${a.id}:nsaUsed`);
      }
      // Units: rows stated in units; keys: the Table 5 count per row; leasable: the revenue rows' area.
      const sell = a.strategy === 'Sell' || a.strategy === 'Sell + Manage';
      const unitRows = rows.filter((u) => ['units', 'count'].includes(String(a.subUnitMetric ?? u.metric)));
      const units = sell ? (() => { const x = all(unitRows.map((u) => su(u, 'units'))); return x ? add(x) : null; })() : { f: '0', v: 0 };
      // KEYS BY resolveAssetKeys: a row stated in units counts its units; a row stated
      // in sqm counts keysFromArea(area, the unit size), the unit size being the average
      // of the rows' stated sizes where any is stated, else the TYPE's (resolveAvgUnitSize).
      const keys = a.strategy === 'Operate' ? (() => {
        const sizes = rows.map((u) => cellX(`su:${u.id}:unit`)).filter((x): x is X => !!x);
        const typeSize = a.assetTypeId ? cellX(`type:${a.assetTypeId}:unit`) : null;
        // 0+ COERCES the count to a number: a lone (x>0) stays a BOOLEAN, and Excel ranks
        // every boolean above every number, so FALSE>0 is TRUE and the size divided by FALSE.
        const posCount = { f: sizes.length ? `(0+${sizes.map((s) => `(${s.f}>0)`).join('+')})` : '0', v: sizes.filter((s) => s.v > 0).length };
        const posSum = { f: sizes.length ? `(${sizes.map((s) => `MAX(0,${s.f})`).join('+')})` : '0', v: sizes.reduce((t, s) => t + Math.max(0, s.v), 0) };
        const size: X = { f: `IF(${posCount.f}>0,${posSum.f}/${posCount.f},${typeSize ? typeSize.f : 0})`, v: posCount.v > 0 ? posSum.v / posCount.v : (typeSize?.v ?? 0) };
        const perRow: Array<X | null> = rows.map((u) => {
          if (String(a.subUnitMetric ?? u.metric) === 'units' || String(a.subUnitMetric ?? u.metric) === 'count') {
            const c = su(u, 'units'); return c ? { f: `MAX(0,ROUND(${c.f},0))`, v: Math.max(0, Math.round(c.v)) } : null;
          }
          const ar = su(u, 'area'); if (!ar) return null;
          return { f: `IF(AND(${ar.f}>0,${size.f}>0),MAX(1,ROUND(${ar.f}/${size.f},0)),0)`, v: ar.v > 0 && size.v > 0 ? Math.max(1, Math.round(ar.v / size.v)) : 0 };
        });
        const x = all(perRow); return x ? add(x) : null;
      })() : { f: '0', v: 0 };
      const leasable = a.strategy === 'Lease' ? (() => { const x = all(rows.map((u) => su(u, 'area'))); return x ? add(x) : null; })() : { f: '0', v: 0 };
      const typeValues = a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined;
      const want: Record<string, number> = {
        bua: m.bua, gfa: m.gfa, nsa: m.nsa,
        units: sell ? computeAssetUnitCount(a, subUnits) : 0,
        keys: a.strategy === 'Operate' ? resolveAssetKeys(a, subUnits, typeValues).keys : 0,
        leasable: a.strategy === 'Lease' ? resolveAssetLeasableSqm(a, subUnits) : 0,
      };
      const got: Record<string, X | null> = { bua, gfa, nsa, units, keys, leasable };
      const bad = Object.keys(want).filter((k) => !got[k] || !near(got[k]!.v, want[k]));
      if (!land || !landValue) bad.push('land');
      if (bad.length) { areaMisses.push(`${a.name} (${bad.join(', ')})`); continue; }
      perAsset.set(a.id, { land: land!, landValue: landValue!, bua: bua!, gfa: gfa!, nsa: nsa!, units: units!, keys: keys!, leasable: leasable! });
    }
    const areasLive = areaMisses.length === 0;
    const sumOver = (ids: string[], k: keyof Row): X => add(ids.map((id) => perAsset.get(id)![k]));
    const ids = visible.map((a) => a.id);

    // ── Words, the overview's formatters as formulas ─────────────────────────
    const T = moneyT(cur);
    const areaW = (e: string): string => `TEXT(ROUND(${e},0),"#,##0")`;
    const pctW = (e: string): string => `TEXT(${e},"0.0%")`;
    const pctN = (cell: string): string => `IF(ISNUMBER(${cell}),TEXT(${cell},"0.0%"),"n/a")`;
    const multN = (cell: string): string => `IF(ISNUMBER(${cell}),TEXT(${cell},"0.00")&"x","n/a")`;
    const div = (a: X, b: X, fmt: (e: string) => string): string => `IF(${b.f}>0,${fmt(`${a.f}/${b.f}`)},"n/a")`;
    const yearW = (x: X): string => `TEXT(${x.f},"0")`;

    const kept: string[] = [];
    let written = 0;
    /** Write text over a registered Summary cell, or record that it stays a value. */
    const put = (key: string, what: string, ok: boolean, formula: () => string): void => {
      w.reset();
      if (!has(key)) return;
      if (!ok) { kept.push(what); return; }
      const f = formula();
      w.fA(w.addr(key), f);
      written++;
    };
    const figure = (x: X | null, want: number | null | undefined): boolean => !!x && want != null && near(x.v, want);

    // ── The years ────────────────────────────────────────────────────────────
    const yearCell = (t: number): X | null => cellX(`tl:year:${pc(t)}`);
    const Xi = resolveReturnsConfig(state.project, N).exitYearOffset;
    const startY = yearCell(0), exitY = yearCell(Xi);
    const yearsOk = figure(startY, rs.yearLabels[0]) && figure(exitY, rs.exitYearLabel);
    put('sum|fact|Horizon', 'the horizon years', yearsOk, () => `"${N} yrs ("&${yearW(startY!)}&" to "&TEXT(${startY!.f}+${N - 1},"0")&")"`);
    put('sum|fact|Exit year', 'the exit year', yearsOk, () => yearW(exitY!));
    put('sum|note|investor', 'the exit year in the investor note', yearsOk, () => `"Investor summary for the open project. Money in ${cur} millions; exit year "&${yearW(exitY!)}&"."`);
    put('sum|tile|Start year', 'the start year', yearsOk, () => yearW(startY!));
    put('sum|tilesub|Model horizon', 'the exit year under the horizon', yearsOk, () => `"to "&${yearW(exitY!)}`);
    put('sum|tile|Exit year', 'the exit year', yearsOk, () => yearW(exitY!));

    // ── Headline returns, over the Checks sheet's live IRR and MOIC ──────────
    const chkLive = (label: string): boolean => {
      const key = `chk|ret|${label}`;
      if (!has(key)) return false;
      const a = w.addr(key);
      return isFormula(a.sheet, a.row, a.col);
    };
    const chk = (label: string): { irr: string; moic: string } => {
      const a = w.addr(`chk|ret|${label}`);
      return { irr: w.refA(a), moic: w.refA({ ...a, col: a.col + 1 }) };
    };
    const pairW = (label: string): string => { const p = chk(label); return `${pctN(p.irr)}&"  ·  "&${multN(p.moic)}`; };
    put('sum|tile|Project (FCFF)', 'the project IRR and MOIC', chkLive('Project IRR (FCFF)'), () => pairW('Project IRR (FCFF)'));
    put('sum|tile|Equity (FCFE)', 'the equity IRR and MOIC', chkLive('Equity IRR (FCFE)'), () => pairW('Equity IRR (FCFE)'));
    {
      const netLabel = has('chk|ret|Distributed Equity IRR (net of performance fee)') ? 'Distributed Equity IRR (net of performance fee)' : 'Distributed Equity IRR';
      put('sum|tile|Distributed (DDM)', 'the distributed IRR and MOIC', chkLive(netLabel), () => pairW(netLabel));
      const feeKey = reg.keys().find((k) => /^retr\|Performance Fee \(hold to .*\|Performance Fee$/.test(k));
      if (chkLive('Distributed Equity IRR (gross)') && feeKey) {
        put('sum|tilesub|Distributed (DDM)', 'the pre-fee pair', true, () => {
          const f = w.addr(feeKey);
          const fee = `SUM(${w.rangeA(f.sheet, f.row, OPEN_COL, OPEN_COL + N)})`;
          const g = chk('Distributed Equity IRR (gross)');
          return `IF(${fee}>0,"IRR and MOIC after the performance fee; pre-fee "&${pctN(g.irr)}&" and "&${multN(g.moic)},"IRR and MOIC")`;
        });
      }
    }

    // ── Sources and uses, and the money the tiles quote ──────────────────────
    const su4 = (label: string): X | null => cellX(`ret|${label}`, TOTAL_COL);
    const land$ = su4('Land'), cons$ = su4('Construction & Infrastructure'), totSrc = su4('Total Sources');
    const debt$ = all([su4('New Debt (incl. capitalised IDC)'), su4('Existing Debt')]);
    const cash$ = all([su4('New Equity (cash)'), su4('Existing Equity')]);
    const kind$ = su4('In-Kind Equity (land)');
    const tdc: X | null = land$ && cons$ ? add([land$, cons$]) : null;
    const tdcOk = figure(tdc, rs.totalDevelopmentCost) && figure(cons$, rs.sourcesUses.construction) && figure(land$, rs.sourcesUses.land);
    const plRev = cellX('pl|__all__||Total Revenue', TOTAL_COL);
    const revOk = figure(plRev, snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + v, 0));
    const gfaT = areasLive ? sumOver(ids, 'gfa') : null, buaT = areasLive ? sumOver(ids, 'bua') : null, nsaT = areasLive ? sumOver(ids, 'nsa') : null;
    const areasOk = areasLive && figure(gfaT, ov.scheme.gfaSqm) && figure(buaT, ov.scheme.buaSqm) && figure(nsaT, ov.scheme.saleableSqm);
    put('sum|tile|Development cost / GFA', 'development cost per sqm of GFA', tdcOk && areasOk, () => div(tdc!, gfaT!, areaW));
    put('sum|tilesub|Development cost / GFA', 'the development cost and GFA', tdcOk && areasOk, () => `${T(tdc!.f)}&" over "&${areaW(gfaT!.f)}&" sqm"`);
    put('sum|tile|Construction cost / GFA', 'construction cost per sqm of GFA', tdcOk && areasOk, () => div(cons$!, gfaT!, areaW));
    put('sum|tile|Development cost / saleable', 'development cost per saleable sqm', tdcOk && areasOk, () => div(tdc!, nsaT!, areaW));
    put('sum|tilesub|Development cost / saleable', 'the saleable area', areasOk, () => `"over "&${areaW(nsaT!.f)}&" sqm"`);
    put('sum|tile|Revenue / saleable', 'revenue per saleable sqm', revOk && areasOk, () => div(plRev!, nsaT!, areaW));
    put('sum|tile|Land Cost', 'the land cost', tdcOk, () => T(land$!.f));
    put('sum|tile|Capex (construction)', 'the construction capex', tdcOk, () => T(cons$!.f));

    const mix = rs.fundingMix;
    const mixOk = !!(debt$ && cash$ && kind$ && totSrc) && totSrc.v > 0
      && near(add(debt$).v / totSrc.v, mix.debtPct ?? 0) && near(add(cash$).v / totSrc.v, mix.cashEquityPct ?? 0) && near(kind$.v / totSrc.v, mix.inKindEquityPct ?? 0);
    {
      const D = mixOk ? add(debt$!) : null, C = mixOk ? add(cash$!) : null, K = kind$, S = totSrc;
      const share = (x: X): string => `IF(${S!.f}>0,${pctW(`${x.f}/${S!.f}`)},"n/a")`;
      put('sum|tile|Debt / Equity (of total sources)', 'the funding mix', mixOk, () => `${share(D!)}&" / "&${share(add([C!, K!]))}`);
      const stack = (): string => `(${D!.f}+${C!.f}+${K!.f})`;
      const ofStack = (x: X): string => `IF(${stack()}>0,${pctW(`${x.f}/${stack()}`)},${pctW('0')})`;
      const parts: Array<[string, () => X]> = [['Debt', () => D!], ['Cash equity', () => C!], ['In-kind equity', () => K!]];
      for (const [label, x] of parts) {
        put(`sum|tbl|Capital stack|${label}|1`, `the ${label.toLowerCase()} share of sources`, mixOk, () => share(x()));
        put(`sum|tbl|Capital stack|${label}|2`, `the ${label.toLowerCase()} share of the stack`, mixOk, () => ofStack(x()));
      }
    }

    // Returns cards that print the Summary's own words.
    const card = (tile: string, cardKey: string): void => {
      const key = `retk|${cardKey}`;
      const src = has(key) ? w.addr(key) : null;
      const same = !!src && isFormula(src.sheet, src.row, src.col) && has(`sum|tile|${tile}`)
        && w.platformValue(src) === w.platformValue(w.addr(`sum|tile|${tile}`));
      put(`sum|tile|${tile}`, tile, same, () => w.refA(src!));
    };
    card('Gross Development Value', 'Development economics|Gross Development Value');
    card('Total Development Cost', 'Development economics|Total Development Cost');
    card('Profit after Financing', 'Development economics|Profit after Financing');
    card('Development Margin', 'Development economics|Development Margin');
    card('Peak Equity', '2. RE Metrics|Peak Equity');
    card('Total Financing Cost', 'Development economics|Total Financing Cost');
    card('Cap Rate at Exit', 'Coverage and profitability detail|Cap Rate at Exit');

    // ── Funding requirement by year, the Method 3 need from the live solve ────
    {
      const need = has('fnc:main:netreq') ? w.addr('fnc:main:netreq') : null;
      // The need row is a CIRCULAR cell: it starts each iteration from 0 rather than a
      // cached platform value (stage 6), so it cannot be proved here from the cells it
      // reads. It is the solve's own Method 3 need, and verify-formula-workbook B proves
      // the words in real Excel against the platform's.
      for (const pt of fundingChartPoints(snap)) {
        const t = snap.yearLabels.indexOf(pt.year);
        put(`sum|fund|${pt.year}`, `the funding requirement for ${pt.year}`, !!need && t >= 0, () => {
          const e = `N(${w.refA({ sheet: need!.sheet, row: need!.row, col: 4 + t })})`;
          return `IF(ROUND(ABS(${e})/1000000,1)=0,"-",IF(${e}<0,"("&TEXT(ABS(${e})/1000000,"#,##0.0")&")",TEXT(ABS(${e})/1000000,"#,##0.0")))`;
        });
      }
    }

    // ── The scheme, and land and build by type ───────────────────────────────
    const landT = cellX('landtot:sqm'), landV = cellX('landtot:value');
    const unitsT = areasLive ? sumOver(ids, 'units') : null, keysT = areasLive ? sumOver(ids, 'keys') : null, leaseT = areasLive ? sumOver(ids, 'leasable') : null;
    const schemeOk = areasOk && figure(landT, ov.scheme.landSqm) && figure(landV, ov.scheme.landValue)
      && figure(unitsT, ov.scheme.units) && figure(keysT, ov.scheme.keys) && figure(leaseT, ov.scheme.leasableSqm);
    put('sum|tile|Total land area', 'the land area', schemeOk, () => `${areaW(landT!.f)}&" sqm"`);
    put('sum|tilesub|Total land area', 'the land value', schemeOk, () => T(landV!.f));
    put('sum|tile|Total GFA', 'the total GFA', schemeOk, () => `${areaW(gfaT!.f)}&" sqm"`);
    put('sum|tilesub|Total GFA', 'the total BUA', schemeOk, () => `"BUA "&${areaW(buaT!.f)}`);
    put('sum|tile|Plot ratio', 'the plot ratio', schemeOk, () => `IF(${landT!.f}>0,TEXT(${gfaT!.f}/${landT!.f},"0.00")&"x","n/a")`);
    put('sum|tile|Saleable and leasable', 'the saleable area', schemeOk, () => `${areaW(nsaT!.f)}&" sqm"`);
    put('sum|tilesub|Saleable and leasable', 'the units, keys and area let', schemeOk,
      () => `${areaW(unitsT!.f)}&" units, "&${areaW(keysT!.f)}&" keys, "&${areaW(leaseT!.f)}&" sqm let"`);
    const dashOr = (x: X): string => `IF(${x.f}>0,${areaW(x.f)},"-")`;
    {
      const byType = new Map<string, string[]>();
      for (const a of visible) { const t = overviewTypeOf(a, state.project); byType.set(t.label, [...(byType.get(t.label) ?? []), a.id]); }
      for (const row of ov.byType) {
        const members = byType.get(row.label) ?? [];
        const ok = schemeOk && members.length > 0 && near(sumOver(members, 'land').v, row.landSqm) && near(sumOver(members, 'gfa').v, row.gfaSqm);
        const R = (col: number) => `sum|tbl|Asset type|${row.label}|${col}`;
        put(R(1), `${row.label} land`, ok, () => areaW(sumOver(members, 'land').f));
        put(R(2), `${row.label} share of land`, ok, () => `IF(${landT!.f}>0,${pctW(`${sumOver(members, 'land').f}/${landT!.f}`)},${pctW('0')})`);
        put(R(3), `${row.label} GFA`, ok, () => areaW(sumOver(members, 'gfa').f));
        put(R(4), `${row.label} units`, ok, () => dashOr(sumOver(members, 'units')));
        put(R(5), `${row.label} keys`, ok, () => dashOr(sumOver(members, 'keys')));
        put(R(6), `${row.label} leasable area`, ok, () => dashOr(sumOver(members, 'leasable')));
      }
      const R = (col: number) => `sum|tbl|Asset type|Total|${col}`;
      put(R(1), 'the land total', schemeOk, () => areaW(landT!.f));
      put(R(3), 'the GFA total', schemeOk, () => areaW(gfaT!.f));
      put(R(4), 'the units total', schemeOk, () => dashOr(unitsT!));
      put(R(5), 'the keys total', schemeOk, () => dashOr(keysT!));
      put(R(6), 'the leasable total', schemeOk, () => dashOr(leaseT!));
    }

    // ── Revenue mix, by the P&L's own section rows ───────────────────────────
    for (const s of ov.revenueMix) {
      const x = cellX(`pl|__all__||${s.label} Revenue`, TOTAL_COL);
      const ok = revOk && figure(x, s.value);
      put(`sum|tbl|Section|${s.label}|1`, `${s.label} revenue`, ok, () => T(x!.f));
      put(`sum|tbl|Section|${s.label}|2`, `${s.label} share of revenue`, ok, () => `IF(${plRev!.f}>0,${pctW(`${x!.f}/${plRev!.f}`)},${pctW('0')})`);
    }

    // ── Phases ───────────────────────────────────────────────────────────────
    for (const ph of ov.phases) {
      const members = visible.filter((a) => a.phaseId === ph.id).map((a) => a.id);
      const R = (col: number) => `sum|tbl|Phase|${ph.name}|${col}`;
      const tl = (k: string): X | null => cellX(`tl:phase:${ph.id}:${k}`);
      const cs = tl('cs'), ce = tl('ce'), os = tl('os');
      // The platform caches these as the words it prints ("Jan 2027"); in Excel they
      // recalculate to the date serial the Inputs sheet holds, which YEAR() reads.
      const yr = (k: string): number => {
        if (!has(`tl:phase:${ph.id}:${k}`)) return NaN;
        const t = w.platformValue(w.addr(`tl:phase:${ph.id}:${k}`));
        const m = typeof t === 'string' ? /(\d{4})\s*$/.exec(t) : null;
        return m ? Number(m[1]) : typeof t === 'number' ? new Date(Date.UTC(1899, 11, 30) + Math.round(t) * 86_400_000).getUTCFullYear() : NaN;
      };
      const datesOk = !!cs && !!ce && !!os && yr("cs") === ph.startYear && yr("ce") === ph.constructionEndYear && yr("os") === ph.operationsStartYear;
      put(R(1), `${ph.name} construction years`, datesOk, () => `TEXT(YEAR(${cs!.f}),"0")&" to "&TEXT(YEAR(${ce!.f}),"0")`);
      put(R(2), `${ph.name} operations start`, datesOk, () => `TEXT(YEAR(${os!.f}),"0")`);
      const areaOk = areasLive && near(sumOver(members, 'land').v, ph.landSqm) && near(sumOver(members, 'gfa').v, ph.gfaSqm);
      put(R(4), `${ph.name} land`, areaOk, () => areaW(sumOver(members, 'land').f));
      put(R(5), `${ph.name} GFA`, areaOk, () => areaW(sumOver(members, 'gfa').f));
      const capex = cellX(`cx2sub:${ph.id}`, TOTAL_COL + 1);
      put(R(6), `${ph.name} capex`, figure(capex, ph.capex), () => T(capex!.f));
      const rev = cellX(`pl|${ph.id}||Total Revenue`, TOTAL_COL), ebitda = cellX(`pl|${ph.id}||EBITDA`, TOTAL_COL);
      put(R(7), `${ph.name} revenue`, figure(rev, ph.revenue), () => T(rev!.f));
      put(R(8), `${ph.name} EBITDA`, figure(ebitda, ph.ebitda), () => T(ebitda!.f));
    }

    // ── Exit and cash ────────────────────────────────────────────────────────
    const tv = cellX('retx|Terminal value, booked as proceeds from disposal'), gain = cellX('retx|Gain on disposal');
    put('sum|tile|Terminal value', 'the terminal value', figure(tv, ov.exit.terminalValue), () => T(tv!.f));
    put('sum|tile|Gain on disposal', 'the gain on disposal', figure(gain, ov.exit.gainOnDisposal), () => T(gain!.f));
    const bsLive = (label: string): boolean => {
      const key = `bs|__all__||${label}`;
      if (!has(key)) return false;
      const a = w.addr(key);
      for (let t = 0; t < N; t++) if (!isFormula(a.sheet, a.row, pc(t))) return false;
      return true;
    };
    const bsRange = (label: string): string => { const a = w.addr(`bs|__all__||${label}`); return w.rangeA(a.sheet, a.row, pc(0), pc(N - 1)); };
    put('sum|tile|Peak debt', 'the peak debt', bsLive('Debt (long-term)'), () => T(`MAX(0,MAX(${bsRange('Debt (long-term)')}))`));
    put('sum|tile|Cash low point', 'the cash low point', bsLive('Cash'), () => T(`MIN(${bsRange('Cash')})`));
    put('sum|tilesub|Cash low point', 'the year of the cash low point', bsLive('Cash') && has(`tl:year:${pc(0)}`) && ov.exit.cashLowYear != null, () => {
      const c = bsRange('Cash');
      const a = w.addr(`tl:year:${pc(0)}`);
      return `"in "&TEXT(INDEX(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))},MATCH(MIN(${c}),${c},0)),"0")`;
    });

    if (!written) return values(`The Summary stays the platform's values: ${[...new Set(kept)].slice(0, 6).join('; ')}.`);
    const misses = [...new Set(kept)];
    return [{
      sheet: SUM, status: 'partial' as const, formulas: w.formulas.get(SUM) ?? 0,
      note: `Live: every figure on this page is text over the live cells that hold it, by the platform overview's own rules: the returns, the costs and the funding mix, the scheme areas (net saleable area is the NSA used on Inputs Table 2, the larger of the sub-units' area and the Stated NSA), the tables by type, revenue section and phase, the exit and the cash low point. As of export: the key facts that are labels, the horizon length, the number of phases and lines, and which rows the tables carry and their order.${areasLive ? '' : ` The areas stay the platform's values: ${areaMisses.slice(0, 4).join('; ')} could not be expressed by the platform's area rule.`}${misses.length ? ` Also the platform's values: ${misses.slice(0, 8).join('; ')}${misses.length > 8 ? ` and ${misses.length - 8} more` : ''}.` : ''}`,
    }];
  },
};
