/**
 * verify-values-mode.ts (2026-11-12, founder: export simplification step 2)
 *
 * THE VALUES FILE CARRIES THE ENGINE'S NUMBERS, ROW BY ROW, ON EVERY SET-UP (valuesWorkbook.ts).
 * For the live reference project, a copy of it set up with each feature the live workbook refuses
 * (Method 4, existing operations, an overlapping phase, a monthly model, an exit before the last
 * year, reducing balance depreciation, balloon repayment, a perpetuity terminal value) and every
 * open project:
 *   V1 the values file builds (nothing refuses);
 *   V2 it carries no formula;
 *   V3 no working row is left (a year flag, a counter, a spend share, a velocity, an inflation
 *      factor: rows the engine has no figure for);
 *   V4 the statements tie to the engine: total revenue, profit after zakat, closing cash and the
 *      balance check;
 *   V5 EVERY period row on every period tab is the engine's: a series the engine produces (the
 *      financials and returns snapshots, the capex report, the area metrics, the case comparison,
 *      each with its sign either way), a line's plots added, last year's closing as this year's
 *      opening, a running total, or the sum of a block of rows next to it, or the sum or difference
 *      of two rows that are themselves the engine's. A row that is none of these is a figure the
 *      builder worked out by itself, which a values file must not show.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-values-mode.ts
 * No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { buildValuesWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook';
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { buildCaseYoYReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseYoYReport';
import { planRevenueLines } from '../src/hubs/modeling/platforms/refm/lib/revenueLines';
import { resolveAssetAreaMetrics } from '../src/core/calculations';
import { computeReturnsSensitivity } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { covenantSeries, evaluateCovenant } from '../src/hubs/modeling/platforms/refm/lib/covenants';
import { DEFAULT_COVENANTS } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { reMetricCovenantInputs } from '../src/hubs/modeling/platforms/refm/lib/reports/reMetricTiles';
import { buildOperatingKpis } from '../src/hubs/modeling/platforms/refm/lib/reports/operatingKpis';
import { buildDisposalWorking } from '../src/hubs/modeling/platforms/refm/lib/reports/disposalReport';
import { buildFixedAssetReport } from '../src/hubs/modeling/platforms/refm/lib/reports/fixedAssetReports';
import { disposalContextOf } from '../src/hubs/modeling/platforms/refm/lib/reports/disposalSchedules';
import { capexCostType, CAPEX_COST_TYPES } from '../src/hubs/modeling/platforms/refm/lib/excel/capexCostType';
import { isExpensedAsIncurred } from '../src/core/calculations/sellingExpense';
import { loadLiveExportInputs, type LiveExportInputs } from './fixtures/liveExportInputs';

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const isF = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const R2 = (x: number): number => Math.round(x * 100) / 100;
const keyOf = (a: number[]): string => a.map((x) => R2(x)).join(',');
const lbl = (ws: ExcelJS.Worksheet, r: number): string => { const v = ws.getCell(r, 1).value as unknown; return typeof v === 'string' ? v.replace(/^\d+\.(\d+)?\s+/, '') : ''; };
const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

/** Every numeric series the engine produces, both signs, axis-aligned (and with an opening in front). */
const SCALARS = new Set<string>();
const scal = (x: number): void => { if (Number.isFinite(x)) { SCALARS.add(String(R2(x))); SCALARS.add(String(R2(-x))); } };
function engineCatalog(roots: unknown[], N: number, lineGroups: string[][]): Set<string> {
  const out = new Set<string>();
  SCALARS.clear();
  const add = (a: number[]): void => {
    if (!a.length) return;
    a.forEach(scal); scal(a.reduce((s2, v) => s2 + v, 0));
    for (const v of [a, a.map((x) => -x)]) {
      const p = v.slice(0, N); while (p.length < N) p.push(0);
      out.add(keyOf(p));
      if (v.length === N + 1) out.add(keyOf(v.slice(1)));
      out.add(`E:${keyOf([0, ...p])}`);
      if (v.length === N + 1) out.add(`E:${keyOf(v)}`);
    }
  };
  const seen = new Set<unknown>();
  const flat = (x: unknown, path: string, depth: number, into: Map<string, number[]>): void => {
    if (depth > 9 || x === null || x === undefined || typeof x !== 'object') return;
    if (seen.has(x) && into === MAIN) return;
    if (into === MAIN) seen.add(x);
    if (Array.isArray(x)) {
      if (x.length && x.every((v) => typeof v === 'number')) { into.set(path, x as number[]); return; }
      x.forEach((v, i) => flat(v, `${path}[${i}]`, depth + 1, into));
      return;
    }
    if (x instanceof Map) {
      // A map keyed by asset id: a line's plots added, path by path.
      const ids = [...x.keys()].map(String);
      for (const g of lineGroups) {
        if (g.length < 2 || !g.every((id) => ids.includes(id))) continue;
        const parts = g.map((id) => { const m = new Map<string, number[]>(); flat(x.get(id), '', 0, m); return m; });
        for (const [p, a0] of parts[0]) {
          const acc = a0.slice();
          let ok = true;
          for (const m of parts.slice(1)) { const b = m.get(p); if (!b) { ok = false; break; } for (let i = 0; i < acc.length; i++) acc[i] += b[i] ?? 0; }
          if (ok) into.set(`${path}<line ${g.join('+')}>${p}`, acc);
        }
      }
      for (const [k, v] of x) flat(v, `${path}<${String(k)}>`, depth + 1, into);
      return;
    }
    for (const [k, v] of Object.entries(x as object)) { if (typeof v === 'number') scal(v); else flat(v, `${path}.${k}`, depth + 1, into); }
  };
  const MAIN = new Map<string, number[]>();
  roots.forEach((r, i) => flat(r, `#${i}`, 0, MAIN));
  for (const a of MAIN.values()) add(a);
  return out;
}

/**
 * A table inside a period tab (its own column heads over the year columns: the returns by stream,
 * the partners, the covenants, the sensitivity grid) is not a year series: its figures are checked
 * one by one as engine values (`tableCells`). A head whose words sit only left of the years (a
 * sale-year table's "Down %") keeps its rows period rows.
 */
const fillOf = (c: ExcelJS.Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
const bar0 = (row: ExcelJS.Row): boolean => fillOf(row.getCell(1)) === 'FF1B4F8A';
function tableRowsOf(ws: ExcelJS.Worksheet): Set<number> {
  const out = new Set<number>();
  let inTable = false, blank = 0;
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    if (r <= 4) return;
    let texts = 0, textRight = false, any = false;
    row.eachCell((c, col) => { any = true; if (typeof c.value === 'string' && c.value) { texts++; if (col >= 6) textRight = true; } });
    // Words in the year columns (a status, a covenant's "Breach") make it a table row, never a year series.
    const statusRow = !bar0(row) && textRight && !(texts >= 2 && [...Array(row.cellCount).keys()].every((i) => typeof row.getCell(i + 1).value !== 'number'));
    if (statusRow) { out.add(r); return; }
    const bar = fillOf(row.getCell(1)) === 'FF1B4F8A' && texts === 1;
    if (!any) { if (++blank >= 1) inTable = false; return; }
    blank = 0;
    if (bar) { inTable = false; return; }
    if (texts >= 2 && textRight) { inTable = true; return; }
    if (inTable) out.add(r);
  });
  return out;
}

function periodRows(ws: ExcelJS.Worksheet, N: number): Map<number, { f: number[]; e: number[] }> {
  const out = new Map<number, { f: number[]; e: number[] }>();
  if (ws.getCell(3, 6).numFmt !== '"Dec "0') return out;
  const tables = tableRowsOf(ws);
  ws.eachRow((row, r) => {
    if (r <= 4 || tables.has(r)) return;
    const f: number[] = []; let any = false;
    for (let c = 6; c < 6 + N; c++) { const n = num(row.getCell(c).value); if (n !== null) any = true; f.push(n ?? 0); }
    if (!any) return;
    const e0 = num(row.getCell(5).value) ?? 0;
    out.set(r, { f, e: [e0, ...f] });
  });
  return out;
}

function tiesOf(wb: ExcelJS.Workbook, snap: Any): { rev: boolean; pat: boolean; cash: boolean; bs: boolean } {
  const N = snap.axisLength;
  const find = (ws: ExcelJS.Worksheet | undefined, re: RegExp): number => { let h = -1; ws?.eachRow((_x, r) => { if (h < 0 && re.test(lbl(ws, r))) h = r; }); return h; };
  const pl = wb.getWorksheet('P&L'), cf = wb.getWorksheet('Cash Flow'), bs = wb.getWorksheet('Balance Sheet');
  const rev = find(pl, /^total revenue$/i), pat = find(pl, /^profit after (zakat|tax)/i), close = find(cf, /^closing cash/i), chk = find(bs, /check|difference/i);
  const hasAssets = sum(snap.pl.totalRevenuePerPeriod) !== 0 || sum(snap.pl.patPerPeriod) !== 0;
  let worst = 0; if (chk > 0) for (let c = 6; c < 6 + N; c++) worst = Math.max(worst, Math.abs(num(bs!.getCell(chk, c).value) ?? 0));
  return {
    rev: rev > 0 && Math.abs((num(pl!.getCell(rev, 4).value) ?? NaN) - sum(snap.pl.totalRevenuePerPeriod)) < 1,
    pat: !hasAssets || (pat > 0 && Math.abs((num(pl!.getCell(pat, 4).value) ?? NaN) - sum(snap.pl.patPerPeriod)) < 1),
    cash: close > 0 && Math.abs((num(cf!.getCell(close, 6 + N - 1).value) ?? NaN) - (snap.directCF.closingCashPerPeriod[N - 1] ?? 0)) < 1,
    bs: chk > 0 && worst < 1,
  };
}

const WORKING_LABEL = /\(1 = yes\)$|: velocity$|: sqm sold$|: sqm unsold at year end$|^Price indexation factor$|^Inflation factor|^Depreciation starts \(year no\.\)$|weighted by plot|^Phase period of the year|^Cost escalation factor|^Land under construction \(sqm\)$|year number$/;

function probe(name: string, input: LiveExportInputs, state: Any, plant = false): void {
  console.log(`\n${name}`);
  let snap: Any;
  try { snap = computeFinancialsSnapshot(state); } catch (e) { check(`${name}: the engine runs`, false, (e as Error).message); return; }
  const opts = { state, projectName: input.projectName, dateLabel: 'd', caseComparison: input.caseComparison ?? undefined, parties: input.parties, includeSensitivity: true };
  let wb: ExcelJS.Workbook;
  try { wb = buildValuesWorkbook(opts).wb; } catch (e) { check(`V1 ${name}: the values file builds`, false, (e as Error).message.slice(0, 200)); return; }
  // THE CHECK FIRES (V7): a copy with one engine figure changed by 1% must be caught at exactly that row.
  let planted = '';
  if (plant) {
    const ws = wb.getWorksheet('Opex')!;
    ws.eachRow((row, r) => { if (planted || r <= 4 || row.getCell(1).font?.bold) return; for (let col = 6; col <= 30 && !planted; col++) { const c = row.getCell(col); if (typeof c.value === "number" && c.value > 1000) { c.value = c.value * 1.01; planted = `Opex!R${r}`; } } });
  }
  check(`V1 ${name}: the values file builds`, true);
  let formulas = 0; const working: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row, r) => {
    row.eachCell((c) => { if (isF(c.value)) formulas++; });
    if (ws.name !== 'Guide' && ws.name !== 'Inputs' && WORKING_LABEL.test(lbl(ws, r))) working.push(`${ws.name}!A${r} ${lbl(ws, r)}`);
  });
  check(`V2 ${name}: no formula`, formulas === 0, `${formulas}`);
  check(`V3 ${name}: no working row the engine has no figure for`, !working.length, working.slice(0, 5).join('; '));
  const t = tiesOf(wb, snap);
  check(`V4 ${name}: total revenue, profit after zakat, closing cash and the balance check tie to the engine`, t.rev && t.pat && t.cash && t.bs, JSON.stringify(t));

  // V5: every period row is the engine's.
  const N = snap.axisLength;
  const rs = (() => { try { return computeReturnsSnapshot(snap, state.project); } catch { return null; } })();
  const capex = (() => { try { return buildCapexReport(snap, state); } catch { return null; } })();
  const metrics = state.assets.filter((a: Any) => a.visible !== false).map((a: Any) => { try { return resolveAssetAreaMetrics(a, state.project, state.parcels, state.assets.filter((x: Any) => x.phaseId === a.phaseId), state.subUnits, state.landAllocationMode); } catch { return null; } });
  const yoy = (() => { try { return input.caseComparison ? buildCaseYoYReport(input.caseComparison as Any) : null; } catch { return null; } })();
  const lines = (() => { try { return planRevenueLines(state.assets, state.subUnits, state.phases, state.project).map((l) => l.members.map((m) => m.id)); } catch { return []; } })();
  // The shared report builders the tabs print from (each reads the engine): covenants, the sensitivity grid,
  // the operating KPIs and the disposal working.
  const safe = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };
  const cov = rs ? safe(() => { const ci = reMetricCovenantInputs(rs as Any, snap.bs.debtOutstandingPerPeriod); return ['dscr', 'icr', 'debt_yield', 'ltv', 'ltv_gdv', 'ltc'].map((m) => covenantSeries(m as Any, ci).map((v) => (v === null ? 0 : v))); }) : null;
  const sens = safe(() => computeReturnsSensitivity(snap, state.project, 'exit_cap_rate', 'sales_price_pct'));
  const kpis = safe(() => buildOperatingKpis(snap, state));
  const disp = rs ? safe(() => buildDisposalWorking(snap, rs as Any, (id: string) => id)) : null;
  const fixedAssets = safe(() => buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) }));
  const gap = safe(() => computeFundingGap(snap));
  // A hotel's RevPAR: the engine's rooms revenue over its available room nights.
  const revpar = [...(snap.revenue.byHospitalityAsset?.values() ?? [])].map((h: Any) => (h.roomsRevenuePerPeriod ?? []).map((v: number, t: number) => ((h.availableRoomNightsPerPeriod?.[t] ?? 0) > 0 ? v / h.availableRoomNightsPerPeriod[t] : 0)));
  // The engine's capex lines added by the one cost-type rule (capexCostType), as the capex summary adds them.
  const byType = capex ? CAPEX_COST_TYPES.map((ct) => { const acc = new Array<number>(N).fill(0); for (const a of capex.inputAssets) for (const ln of a.lines) { const cl = state.costLines.find((c: Any) => c.id === ln.id); if (!cl || isExpensedAsIncurred(cl) || capexCostType(cl) !== ct.id) continue; ln.perPeriod.forEach((v: number, t: number) => { if (t < N) acc[t] += v ?? 0; }); } return acc; }) : null;
  // The covenants the Returns tab evaluates: the project's own thresholds or the platform defaults, and each one's evaluation.
  const covs = (state.project.covenants ?? DEFAULT_COVENANTS) as Any[];
  const covEval = rs ? safe(() => { const ci = reMetricCovenantInputs(rs as Any, snap.bs.debtOutstandingPerPeriod); return covs.map((c) => evaluateCovenant(c, ci)); }) : null;
  // The model's own inputs too: a covenant threshold or a rate printed beside a result is typed, not worked out.
  const cat = engineCatalog([snap, rs, capex, metrics, yoy, cov, sens, kpis, disp, fixedAssets, gap, state, covs, covEval, byType, revpar], N, lines);
  const unmatched: string[] = [];
  let rowsChecked = 0;
  for (const ws of wb.worksheets) {
    // The Timeline's tables are dates and phase lengths (the inputs), not period figures.
    if (ws.name === 'Timeline') continue;
    const rows = periodRows(ws, N);
    const order = [...rows.keys()].sort((a, b) => a - b);
    const ok = new Set<number>();
    const direct = (v: { f: number[]; e: number[] }): boolean => v.f.every((x) => R2(x) === 0) || cat.has(keyOf(v.f)) || cat.has(`E:${keyOf(v.e)}`);
    for (const r of order) if (direct(rows.get(r)!)) ok.add(r);
    // Identities over rows already shown to be the engine's, repeated until nothing new ties.
    for (let changed = true; changed;) {
      changed = false;
      for (const r of order) {
        if (ok.has(r)) continue;
        const v = rows.get(r)!.f; const k = keyOf(v);
        const okRows = order.filter((x) => ok.has(x) && x !== r);
        let hit = false;
        // Opening = last year's closing; a running total.
        for (const o of okRows) {
          const w = rows.get(o)!.f;
          const shifted = [rows.get(o)!.e[0], ...w.slice(0, N - 1)];
          if (keyOf(shifted) === k || keyOf(w.slice(0, N - 1).length ? [0, ...w.slice(0, N - 1)] : []) === k) { hit = true; break; }
          let acc = 0; if (keyOf(w.map((x) => (acc += x))) === k) { hit = true; break; }
        }
        // The same as another of the engine's rows.
        if (!hit) for (const o of okRows) { const w = rows.get(o)!.f; if (keyOf(w) === k || keyOf(w.map((x) => -x)) === k) { hit = true; break; } }
        // A project row: the rows above it with the same words, added.
        if (!hit) {
          const words = lbl(ws, r).toLowerCase();
          const same = order.filter((x) => x < r && lbl(ws, x).toLowerCase() === words);
          if (same.length >= 2) { const acc = new Array<number>(N).fill(0); for (const x of same) rows.get(x)!.f.forEach((y, i) => (acc[i] += y)); if (keyOf(acc) === k || keyOf(acc.map((x) => -x)) === k) hit = true; }
        }
        // A block total: the line items (not bold) since the section's bar, added.
        if (!hit) {
          let top = r - 1; while (top > 4 && !(fillOf(ws.getCell(top, 1)) === 'FF1B4F8A' && !rows.has(top))) top--;
          const acc = new Array<number>(N).fill(0);
          for (const x of order) if (x > top && x < r && !ws.getCell(x, 1).font?.bold) rows.get(x)!.f.forEach((y, i) => (acc[i] += y));
          if (keyOf(acc) === k || keyOf(acc.map((x) => -x)) === k) hit = true;
        }
        // Every figure on the row an engine value (a single-year figure: a disposal at the exit, a grid of returns).
        if (!hit) {
          const nz = v.filter((x) => R2(x) !== 0);
          if (nz.length && nz.every((x) => SCALARS.has(String(R2(x))) && !(Number.isInteger(x) && Math.abs(x) <= 100))) hit = true;
        }
        // The ratio of two of the engine's rows (RevPAR: rooms revenue over the nights available).
        if (!hit) {
          outer2: for (const a0 of okRows) for (const b0 of okRows) {
            if (a0 === b0) continue;
            const a = rows.get(a0)!.f, b = rows.get(b0)!.f;
            if (!b.some((x) => x !== 0)) continue;
            if (keyOf(a.map((x, t) => (b[t] ? x / b[t] : 0))) === k) { hit = true; break outer2; }
          }
        }
        // A block of rows next to it (a total under its rows, a group head over them).
        if (!hit) {
          const idx = order.indexOf(r);
          for (const dir of [-1, 1]) {
            const acc = new Array<number>(N).fill(0);
            for (let j = idx + dir, n = 0; j >= 0 && j < order.length && n < 80; j += dir, n++) {
              const w = rows.get(order[j])!.f; for (let i = 0; i < N; i++) acc[i] += w[i];
              if (n >= 1 && keyOf(acc) === k) { hit = true; break; }
            }
            if (hit) break;
          }
        }
        // The sum or difference of two of the engine's rows.
        if (!hit) {
          outer: for (let i = 0; i < okRows.length; i++) {
            const a = rows.get(okRows[i])!.f;
            for (let j = i + 1; j < okRows.length; j++) {
              const b = rows.get(okRows[j])!.f;
              for (const sgn of [1, -1]) {
                let same = true, neg = true;
                for (let t = 0; t < N; t++) { const s = R2(a[t] + sgn * b[t]); if (s !== R2(v[t])) same = false; if (s !== R2(-v[t])) neg = false; if (!same && !neg) break; }
                if (same || neg) { hit = true; break outer; }
              }
            }
          }
        }
        if (hit) { ok.add(r); changed = true; }
      }
    }
    rowsChecked += order.length;
    for (const r of order) if (!ok.has(r)) unmatched.push(`${ws.name}!R${r} ${lbl(ws, r).slice(0, 50)}`);
  }
  const badCells: string[] = [];
  let cellsChecked = 0;
  for (const ws of wb.worksheets) {
    if (ws.name === 'Timeline' || ws.getCell(3, 6).numFmt !== '"Dec "0') continue;
    const tables = [...tableRowsOf(ws)].sort((a, b) => a - b);
    for (const r of tables) {
      ws.getRow(r).eachCell((c, col) => {
        const n = num(c.value); if (n === null || col < 2) return;
        cellsChecked++;
        if (R2(n) === 0 || SCALARS.has(String(R2(n)))) return;
        // The column's total over the table rows above it.
        let acc = 0; for (let k = tables.indexOf(r) - 1; k >= 0 && tables[k] === r - (tables.indexOf(r) - k); k--) { acc += num(ws.getCell(tables[k], col).value) ?? 0; if (R2(acc) === R2(n)) return; }
        badCells.push(`${ws.name}!${c.address} ${lbl(ws, r).slice(0, 40)}`);
      });
    }
  }
  check(`V6 ${name}: every figure in a table is an engine value or its column's total (${cellsChecked} figures)`, !badCells.length, `${badCells.length} not: ${badCells.slice(0, Number(process.env.SHOW ?? 25)).join(' | ')}`);
  if (plant) { check(`V7 ${name}: a figure changed by 1% in a copy is caught at exactly its row (${planted})`, !!planted && unmatched.length === 1 && unmatched[0].startsWith(`${planted} `), unmatched.slice(0, 3).join(' | ')); return; }
  check(`V5 ${name}: every period row is the engine's (${rowsChecked} rows)`, !unmatched.length, `${unmatched.length} not: ${unmatched.slice(0, Number(process.env.SHOW ?? 25)).join(' | ')}`);
}

async function main(): Promise<void> {
  const live = await loadLiveExportInputs();
  probe('Marina Gate', live, live.state);
  probe('Marina Gate, planted', live, live.state, true);
  // --first: the reference project only, for iterating (reported as a failure, never a proof).
  if (process.argv.includes('--first')) { check('--first ran the reference project only (iteration; never a proof)', false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
  const clone = (): Any => JSON.parse(JSON.stringify(live.state));
  const variants: Array<[string, (s: Any) => void]> = [
    ['Method 4 (specified debt + equity)', (s) => { s.project.financing = { ...s.project.financing, fundingMethod: 4, fixedAmountConfig: { debtAmount: 500e6, equityAmount: 700e6, yoySchedule: [25, 25, 25, 25] } }; }],
    ['existing operations (Phase 1 operational)', (s) => { s.phases[0].status = 'operational'; }],
    ['overlapping phases (Phase 2 overlaps 1 year)', (s) => { s.phases[1].overlapPeriods = 1; }],
    ['monthly model', (s) => { s.project.modelType = 'monthly'; }],
    ['exit before the last year', (s) => { s.project.returns = { ...(s.project.returns ?? {}), exitYearOffset: 7 }; }],
    ['reducing balance depreciation', (s) => { for (const a of s.assets) a.depreciationMethod = 'reducing_balance'; }],
    ['balloon repayment', (s) => { for (const t of s.financingTranches) { t.repaymentMethod = 'balloon'; t.balloonPct = 50; } }],
    ['perpetuity terminal value', (s) => { s.project.returns = { ...(s.project.returns ?? {}), terminalMethod: 'perpetuity' }; }],
  ];
  for (const [n, f] of variants) { const s = clone(); f(s); probe(n, live, s); }
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from('refm_projects').select('id, name, archived').is('deleted_at', null);
  check('the open projects load', !error, error?.message);
  for (const p of (data ?? []).filter((x: { archived?: boolean }) => !x.archived)) {
    try { const inp = await loadLiveExportInputs(p.id); probe(`project ${p.name}`, inp, inp.state); }
    catch (e) { check(`project ${p.name} loads`, false, (e as Error).message.slice(0, 120)); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
