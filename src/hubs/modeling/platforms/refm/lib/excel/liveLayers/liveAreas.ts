/**
 * liveAreas.ts (2026-09-28)
 *
 * THE AREA OF EACH ASSET, AS LIVE CELLS, STATED ONCE for every layer that
 * divides or sums by it (the Summary, Capex Table 7). Lifted verbatim out of
 * the Summary layer when Table 7 became the second reader, so the workbook
 * carries one expression of resolveAssetAreaMetrics, not two.
 *
 * Every figure is a pair (X): the Excel formula over the live cells, and the
 * same arithmetic over the platform values cached in those cells; an asset
 * whose pair does not equal the platform's rule is reported as a miss and has
 * no row, so a caller cannot publish an area that disagrees with the platform.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { LiveWriter } from './writer';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { resolveAssetAreaMetrics, computeAssetUnitCount } from '@/src/core/calculations';
import { resolveAssetKeys, resolveAssetLeasableSqm } from '../../revenue-resolvers';
import type { FinancialsResolverState } from '../../financials-resolvers';
import type { Asset, SubUnit } from '../../state/module1-types';

/** A figure twice: the Excel formula, and its value over the platform's cells. */
export interface X { f: string; v: number }

export interface FigureTools {
  isFormula: (sheet: string, row: number, col: number) => boolean;
  pv: (sheet: string, row: number, col: number) => number;
  cellX: (key: string, col?: number) => X | null;
  add: (xs: X[]) => X;
  all: <T>(xs: Array<T | null>) => T[] | null;
  near: (a: number, b: number) => boolean;
}

export function figureTools(wb: ExcelJS.Workbook, w: LiveWriter): FigureTools {
  const has = (k: string): boolean => w.has(k);
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
  return { isFormula, pv, cellX, add, all, near };
}

export type AreaRow = { land: X; landValue: X; gfa: X; bua: X; nsa: X; units: X; keys: X; leasable: X };

/** Each visible asset's area figures, proved against the platform's rules; the misses are named. */
export function liveAssetAreas(tools: FigureTools, state: Pick<FinancialsResolverState, 'project' | 'parcels' | 'subUnits' | 'landAllocationMode'>, visible: Asset[]): { perAsset: Map<string, AreaRow>; misses: string[] } {
  const { cellX, add, all, near } = tools;
  type Row = AreaRow;
    const perAsset = new Map<string, Row>();
    const misses: string[] = [];
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
      if (bad.length) { misses.push(`${a.name} (${bad.join(', ')})`); continue; }
      perAsset.set(a.id, { land: land!, landValue: landValue!, bua: bua!, gfa: gfa!, nsa: nsa!, units: units!, keys: keys!, leasable: leasable! });
    }
  return { perAsset, misses };
}
