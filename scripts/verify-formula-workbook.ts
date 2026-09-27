/**
 * verify-formula-workbook.ts (2026-09-27)
 *
 * THE PROOF FOR THE FORMULA-LINKED EXCEL EXPORT, on the live project.
 *
 *   A. Offline. The hardcoded export is unchanged by the registry (built with
 *      and without it, cell for cell); in the formula workbook every cell a
 *      layer did NOT touch is the hardcoded value, and every formula caches the
 *      platform value; every sheet states its real status and none still claims
 *      the whole workbook is a hardcoded snapshot; iteration is switched on.
 *   B. REAL EXCEL, before any input is touched. The workbook is opened in Excel,
 *      fully recalculated, and EVERY number the platform wrote is compared with
 *      what Excel computed: exact outside the circular financing (the smaller of
 *      half a cent and one part in a billion), within 1 currency unit inside it
 *      (the engine's own convergence tolerance). No cell may be an Excel error.
 *   C. REAL EXCEL, after an input changes (from stage 1): each registered
 *      perturbation is applied to the platform state (engine re-run) AND typed
 *      into the input cell in Excel; after recalculation every live cell must
 *      match the re-run engine. That is the proof the chain responds.
 *
 * Excel is required for B and C: where it is absent they report a named skip.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-formula-workbook.ts
 *
 * No em dashes in this file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import type ExcelJS from 'exceljs';
import { buildModelWorkbook, enableIterativeCalc } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { buildFormulaWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { loadLiveExportInputs } from './fixtures/liveExportInputs';
import { excelAvailable, recalcInExcel, cellKey } from './excelRecalc';
import JSZip from 'jszip';
import { planRevenueLines } from '../src/hubs/modeling/platforms/refm/lib/revenueLines';
import { CellRegistry } from '../src/hubs/modeling/platforms/refm/lib/excel/cellRegistry';
import { platformAfterEdit } from './fixtures/platformAfterEdit';
import type { LiveExportInputs } from './fixtures/liveExportInputs';

const colLetterOf = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (serial: number): string => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** The platform's value at an address of a hardcoded workbook: a number, a text, or undefined (blank). */
function plainAt(plainWb: ExcelJS.Workbook, sheet: string, r: number, c: number): number | string | undefined {
  const ws = plainWb.getWorksheet(sheet); if (!ws) return undefined;
  // findRow / findCell never CREATE a row: getCell does, which grew the platform sheet's row
  // count on the first read and hid the rows a layer appends below it.
  const v = ws.findRow(r)?.findCell(c)?.value as unknown;
  const x = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
  return typeof x === 'number' || typeof x === 'string' ? x : undefined;
}
/**
 * WHICH PLATFORM ROW EACH LIVE ROW IS, after an input change.
 *
 * The live workbook keeps the layout it was exported with; the platform, re-run
 * on a changed input, can print a different set of rows (a sale year that no
 * longer sells has no "Sold in" row, and every row below moves up). So rows are
 * paired by WHAT THEY ARE: the k-th row carrying a label in the live sheet is
 * the k-th row carrying it on the platform, the label being Excel's own where
 * the label is itself a formula. A row with no label keeps its distance from
 * the labelled row above it. Unchanged inputs pair every row with itself.
 */
function mapRows(sheet: string, basePws: ExcelJS.Worksheet, pertPws: ExcelJS.Worksheet, liveWs: ExcelJS.Worksheet, rec: ReturnType<typeof recalcInExcel> | null): Map<number, number | undefined> {
  const text = (v: unknown): string => {
    const x = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
    return typeof x === 'string' ? x.trim() : '';
  };
  const liveLabel = (r: number): string => {
    const v = liveWs.getCell(r, 1).value as unknown;
    if (v && typeof v === 'object' && 'formula' in (v as object) && rec) { const e = rec.cells.get(cellKey(sheet, r, 1)); return typeof e === 'string' ? e.trim() : ''; }
    return text(basePws.getCell(r, 1).value);
  };
  // THE LABEL SEQUENCES ARE ALIGNED, not counted: a longest common subsequence
  // (what a diff does), so a row that disappears in one table cannot pair a row
  // below it with a same-named row in the next table. Unlabelled rows keep their
  // distance from the labelled row above, when that row paired.
  const L: Array<{ r: number; l: string }> = [];
  for (let r = 1; r <= basePws.rowCount; r++) { const l = liveLabel(r); if (l) L.push({ r, l }); }
  const P: Array<{ r: number; l: string }> = [];
  for (let r = 1; r <= pertPws.rowCount; r++) { const l = text(pertPws.getCell(r, 1).value); if (l) P.push({ r, l }); }
  const n = L.length, m = P.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = L[i].l === P[j].l ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const paired = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (L[i].l === P[j].l) { paired.set(L[i].r, P[j].r); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const out = new Map<number, number | undefined>();
  let anchor: { live: number; pert: number | undefined } = { live: 0, pert: 0 };
  for (let r = 1; r <= basePws.rowCount; r++) {
    if (liveLabel(r)) {
      const mm = paired.get(r);
      out.set(r, mm);
      anchor = { live: r, pert: mm };
    } else {
      out.set(r, anchor.pert === undefined ? undefined : anchor.pert + (r - anchor.live));
    }
  }
  return out;
}

/** Every formula cell on a sheet the platform itself builds (a hidden working
 *  sheet has no platform twin), compared with the platform's figure in the row
 *  it pairs with: numbers to the tolerance, text exactly, a month text against a
 *  date serial, blank against blank. A cell whose row the platform no longer
 *  prints after the change, or which it prints blank, is LAYOUT (the live
 *  workbook keeps its exported layout) and is counted, never compared as zero. */
function compareLive(basePlain: ExcelJS.Workbook, pertPlain: ExcelJS.Workbook, wb: ExcelJS.Workbook, rec: ReturnType<typeof recalcInExcel>): { bad: Array<{ addr: string; kind: 'number' | 'text'; msg: string }>; layout: string[] } {
  const bad: Array<{ addr: string; kind: 'number' | 'text'; msg: string }> = [];
  const layout: string[] = [];
  for (const ws of wb.worksheets) {
    const bws = basePlain.getWorksheet(ws.name), pws = pertPlain.getWorksheet(ws.name);
    if (!bws || !pws) continue;
    // Rows a layer APPENDED below the platform sheet (its live-model inputs) have no platform twin.
    const lastPlatformRow = bws.rowCount;
    const rows = mapRows(ws.name, bws, pws, ws, rec);
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      const v = cell.value as unknown;
      if (!(v && typeof v === 'object' && 'formula' in (v as object))) return;
      if (r > lastPlatformRow) return;
      const addr = cellKey(ws.name, r, c);
      const e = rec.cells.get(addr);
      const m = rows.get(r);
      if (m === undefined) { if (e !== undefined && e !== 0) layout.push(addr); return; }
      const o = plainAt(pertPlain, ws.name, m, c);
      if (typeof o === 'number') {
        if (typeof e !== 'number' || Math.abs(e - o) > tolFor(ws.name, o)) bad.push({ addr, kind: 'number', msg: `${addr}${m !== r ? ` (platform row ${m})` : ''}: Excel ${JSON.stringify(e)} vs platform ${o}` });
      } else if (typeof o === 'string') {
        const ok = typeof e === 'string' ? e.trim() === o.trim()
          : typeof e === 'number' && /^[A-Z][a-z]{2} \d{4}$/.test(o) && monthYear(e) === o;
        if (!ok) bad.push({ addr, kind: 'text', msg: `${addr}${m !== r ? ` (platform row ${m})` : ''}: Excel ${JSON.stringify(e)} vs platform "${o}"` });
      } else if (e !== undefined && !(typeof e === 'number' && e === 0)) {
        // The platform prints this cell blank after the change: layout, when the
        // inputs changed; on unchanged inputs it is a real difference.
        if (basePlain === pertPlain) bad.push({ addr, kind: 'text', msg: `${addr}: Excel ${JSON.stringify(e)} vs platform blank` });
        else layout.push(addr);
      }
    }));
  }
  return { bad, layout };
}
/** Formula cells whose platform figure differs between two builds, rows paired by label. */
function movedCells(a: ExcelJS.Workbook, b: ExcelJS.Workbook, live: ExcelJS.Workbook): number {
  let n = 0;
  for (const ws of live.worksheets) {
    const aws = a.getWorksheet(ws.name), bws = b.getWorksheet(ws.name);
    if (!aws || !bws) continue;
    const rows = mapRows(ws.name, aws, bws, ws, null);
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      const v = cell.value as unknown;
      if (!(v && typeof v === 'object' && 'formula' in (v as object))) return;
      if (r > aws.rowCount) return;
      const m = rows.get(r);
      const x = plainAt(a, ws.name, r, c), y = m === undefined ? undefined : plainAt(b, ws.name, m, c);
      if (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) > 1e-6 : x !== y) n++;
    }));
  }
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = LiveExportInputs['snapshot'] & Record<string, any>;
/** `variant`: the live model has no instance of the branch under test, so a copy is
 *  made that has one (a structural edit, re-run through the platform and exported
 *  afresh) and the input change is tested on THAT workbook. */
type Perturbation = { label: string; cell: string; value: number; edit: (s: Snap) => void; variant?: (s: Snap) => void; movesRevenue: boolean; col?: number } | { label: string; skip: string };
/**
 * THE INPUT CHANGES, each target chosen by a RULE from the model (never a fixed
 * id), so the test keeps meaning the same thing as the project changes. A rule
 * that finds no target FAILS by name rather than passing quietly.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function perturbations(input: LiveExportInputs, reg: CellRegistry): Perturbation[] {
  const st = input.state as any;
  const out: Perturbation[] = [];
  const hosts = (st.assets as any[]).filter((a) => a.visible !== false && a.isCompanion !== true && reg.get(`chain:${a.id}:land`));
  const strips = (st.assets as any[]).filter((a) => a.visible !== false && a.companionType === 'retail');
  const hostIds = new Set(strips.flatMap((s) => s.retailHostAssetIds ?? []));
  const assetOf = (s: Snap, id: string): any => (s.assets as any[]).find((a) => a.id === id);
  // 1. A plot's area, where one asset draws the whole plot. Where no asset does,
  //    a copy is made in which the only asset on a plot stops typing its draw.
  const soleOn = (pid: string): boolean => hosts.filter((h) => h.landAllocation?.parcelId === pid).length === 1;
  const whole = hosts.find((a) => !(a.landAllocation?.sqm > 0) && !(a.landAreaSqm > 0) && a.landAllocation?.parcelId);
  const sole = whole ?? hosts.find((a) => a.landAllocation?.parcelId && soleOn(a.landAllocation.parcelId) && !hostIds.has(a.id));
  if (sole) {
    const pa = (st.parcels as any[]).find((p) => p.id === sole.landAllocation.parcelId);
    const v = Math.round(pa.area * 1.1);
    out.push({
      movesRevenue: true, label: `plot area of a plot one asset draws whole (${pa.name}${whole ? '' : ', on a copy where its only asset stops typing its draw'}) +10%`,
      cell: `parcel:${pa.id}:area`, value: v,
      edit: (s) => { (s.parcels as any[]).find((p) => p.id === pa.id).area = v; },
      ...(whole ? {} : { variant: (s: Snap) => { const a = assetOf(s, sole.id); delete a.landAllocation.sqm; delete a.landAreaSqm; } }),
    });
  } else out.push({ label: 'plot area of a whole-plot draw', skip: 'no plot has a single asset' });
  // 2. A typed land draw on a retail host (the carve moves with it).
  const typedHost = hosts.find((a) => hostIds.has(a.id) && a.landAllocation?.sqm > 0);
  if (typedHost) {
    const v = Math.round(typedHost.landAllocation.sqm * 0.9);
    out.push({ movesRevenue: true, label: `typed land draw of a retail host (${typedHost.name}) -10%`, cell: `entry:${typedHost.id}:plot`, value: v, edit: (s) => { assetOf(s, typedHost.id).landAllocation.sqm = v; } });
  } else out.push({ label: 'typed land draw of a retail host', skip: 'no retail host draws a typed area' });
  // 3. FAR typed on a retail host.
  const farHost = hosts.find((a) => hostIds.has(a.id) && typeof a.landChain?.farRatio === 'number');
  if (farHost) {
    const v = Math.round(farHost.landChain.farRatio * 1.2 * 100) / 100;
    out.push({ movesRevenue: true, label: `FAR of a retail host (${farHost.name}) +20%`, cell: `entry:${farHost.id}:far`, value: v, edit: (s) => { assetOf(s, farHost.id).landChain.farRatio = v; } });
  } else out.push({ label: 'FAR typed on a retail host', skip: 'none' });
  // 4. Coverage typed on a retail host.
  const covHost = hosts.find((a) => hostIds.has(a.id) && typeof a.landChain?.coveragePct === 'number');
  if (covHost) {
    const pct = Math.max(5, covHost.landChain.coveragePct - 5);
    out.push({ movesRevenue: true, label: `ground coverage of a retail host (${covHost.name}) -5 points`, cell: `entry:${covHost.id}:cov`, value: pct / 100, edit: (s) => { assetOf(s, covHost.id).landChain.coveragePct = pct; } });
  } else out.push({ label: 'coverage typed on a retail host', skip: 'none' });
  // 5. Retail share on a retail host.
  const retHost = hosts.find((a) => hostIds.has(a.id) && (a.landChain?.retailPct ?? 0) > 0);
  if (retHost) {
    const pct = retHost.landChain.retailPct + 5;
    out.push({ movesRevenue: true, label: `retail share of a retail host (${retHost.name}) +5 points`, cell: `entry:${retHost.id}:retail`, value: pct / 100, edit: (s) => { assetOf(s, retHost.id).landChain.retailPct = pct; } });
  } else out.push({ label: 'retail share on a retail host', skip: 'none' });
  // 6. A massing figure a plot INHERITS from its type (the plot states none).
  //    Where no plot inherits, a copy moves one plot's typed FAR onto its type.
  const inh = hosts.find((a) => typeof a.landChain?.farRatio !== 'number' && reg.get(`type:${a.assetTypeId}:far`)
    && typeof st.project.assetTypeValues?.[a.assetTypeId]?.farRatio === 'number');
  const donor = inh ?? hosts.find((a) => !hostIds.has(a.id) && typeof a.landChain?.farRatio === 'number' && reg.get(`type:${a.assetTypeId}:far`)
    && hosts.filter((h) => h.assetTypeId === a.assetTypeId).length === 1);
  if (donor) {
    const base = inh ? st.project.assetTypeValues[inh.assetTypeId].farRatio : donor.landChain.farRatio;
    const v = Math.round(base * 1.15 * 100) / 100;
    out.push({
      movesRevenue: true, label: `a type FAR a plot inherits (${donor.name}${inh ? '' : ', on a copy where the plot states none and its type does'}) +15%`,
      cell: `type:${donor.assetTypeId}:far`, value: v,
      edit: (s) => { s.project.assetTypeValues![donor.assetTypeId].farRatio = v; },
      ...(inh ? {} : { variant: (s: Snap) => {
        s.project.assetTypeValues = { ...(s.project.assetTypeValues ?? {}), [donor.assetTypeId]: { ...(s.project.assetTypeValues?.[donor.assetTypeId] ?? {}), farRatio: base } };
        delete assetOf(s, donor.id).landChain.farRatio;
      } }),
    });
  } else out.push({ label: 'a type FAR a plot inherits', skip: 'no plot inherits a FAR, and no single-plot type to move one onto' });
  // 7. Parking area per slot.
  if (typeof st.project.parkingAreaPerSlotSqm === 'number') {
    const v = st.project.parkingAreaPerSlotSqm + 5;
    out.push({ movesRevenue: false, label: 'parking area per slot +5 sqm', cell: 'project:slotArea', value: v, edit: (s) => { s.project.parkingAreaPerSlotSqm = v; } });
  } else out.push({ label: 'parking area per slot', skip: 'not set' });
  // 8. The retail parking ratio the chain reads (resolveRetailSlotArea's rule).
  const rv = st.project.assetTypeValues ?? {};
  const rid = Object.keys(rv).sort().filter((id) => rv[id]?.parkingRatioBasis === 'sqm_per_slot' && rv[id]?.parkingRatio > 0);
  const slotId = rid.includes('retail-ground-floor') ? 'retail-ground-floor' : rid.length === 1 ? rid[0] : undefined;
  if (slotId && strips.length) {
    const listed = (st.project.assetTypes ?? []).some((t: any) => t.id === slotId);
    const v = rv[slotId].parkingRatio + 10;
    out.push({ movesRevenue: false, label: `retail sqm per parking slot +10 (held by ${slotId}${listed ? '' : ', a type not in the list'})`, cell: listed ? `type:${slotId}:ratio` : 'project:retailSlotArea', value: v, edit: (s) => { s.project.assetTypeValues![slotId].parkingRatio = v; } });
  } else out.push({ label: 'retail sqm per parking slot', skip: 'no retail strip or no ratio' });
  // 9. A phase's construction period, and 10. a phase's start date. THE AXIS IS FIXED
  //    AT EXPORT (the sheet says so), so each change is chosen so the project still
  //    starts and ends in the same years: a shorter build on a phase that does not
  //    alone set the end, and an earlier start on a phase that does not set the start.
  const ph = st.phases as any[];
  const yr = (p: any): number => Number(String(p.startDate).slice(0, 4));
  const endYr = (p: any, cp = p.constructionPeriods, sy = yr(p)): number => sy + cp + p.operationsPeriods - 1;
  const lastEnd = Math.max(...ph.map((p) => endYr(p)));
  const firstStart = Math.min(...ph.map(yr));
  const shorten = ph.find((p) => p.constructionPeriods >= 2 && ph.some((q) => q !== p && endYr(q) === lastEnd));
  if (shorten) {
    out.push({ movesRevenue: true, label: `construction years of ${shorten.name} -1 (the project still ends in ${lastEnd})`, cell: `phase:${shorten.id}:cp`, value: shorten.constructionPeriods - 1,
      edit: (s) => { (s.phases as any[]).find((x) => x.id === shorten.id).constructionPeriods = shorten.constructionPeriods - 1; } });
  } else out.push({ label: 'construction years of a phase', skip: 'no phase can shorten without moving the project end' });
  const later = ph.find((p) => yr(p) - 1 >= firstStart && yr(p) > firstStart && endYr(p, p.constructionPeriods, yr(p) - 1) <= lastEnd);
  if (later) {
    const d = new Date(`${later.startDate.slice(0, 10)}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1);
    const iso = d.toISOString().slice(0, 10);
    const serial = Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
    out.push({ movesRevenue: true, label: `start date of ${later.name} one year earlier (the project still starts in ${firstStart})`, cell: `phase:${later.id}:start`, value: serial, edit: (s) => { (s.phases as any[]).find((p) => p.id === later.id).startDate = iso; } });
  } else out.push({ label: 'start date of a later phase', skip: 'no phase can move earlier inside the axis' });
  // ── STAGE 2, CAPEX: inputs that move cost and not revenue ──
  const rowsStd = (st.project.costStandardRows ?? []) as any[];
  const stdEdit = (id: string, label: string, to: (rate: number) => number, isPercent: boolean): void => {
    const row = rowsStd.find((x) => x.id === id);
    if (!row || typeof row.rate !== 'number' || !reg.get(`std:${id}:rate`)) { out.push({ label, skip: `standard row ${id} not shown with a rate` }); return; }
    const v = to(row.rate);
    out.push({ movesRevenue: false, label, cell: `std:${id}:rate`, value: isPercent ? v / 100 : v,
      edit: (s) => { (s.project.costStandardRows as any[]).find((x) => x.id === id).rate = v; } });
  };
  // The standard row each rule names is the one the model's own lines charge, found by rule.
  const usedType = hosts.find((a) => a.assetTypeId && rowsStd.some((x) => x.id === `type:${a.assetTypeId}` && typeof x.rate === 'number'))?.assetTypeId;
  if (usedType) stdEdit(`type:${usedType}`, `construction rate of a type in use (${usedType}) +10%`, (r) => Math.round(r * 1.1), false);
  else out.push({ label: 'construction rate of a type in use', skip: 'no type row with a rate' });
  const byCatalog = (cat: string): any => rowsStd.find((x) => x.catalogId === cat && !x.assetTypeId && !(x.appliesToTypeIds ?? []).length && typeof x.rate === 'number');
  const park = byCatalog('construction-parking');
  if (park) stdEdit(park.id, 'parking construction rate +200', (r) => r + 200, false); else out.push({ label: 'parking construction rate', skip: 'no row' });
  const scoped = rowsStd.find((x) => (x.appliesToTypeIds ?? []).length > 0 && typeof x.rate === 'number');
  if (scoped) stdEdit(scoped.id, `a rate scoped to some types (${scoped.label}) +100`, (r) => r + 100, false); else out.push({ label: 'a scoped standard rate', skip: 'no scoped row' });
  const soft = rowsStd.find((x) => x.list === 'soft' && x.method === 'percent_of_selected' && typeof x.rate === 'number' && x.rate >= 5);
  if (soft) stdEdit(soft.id, `a soft percentage (${soft.label}) +2 points`, (r) => r + 2, true); else out.push({ label: 'a soft percentage', skip: 'no row' });
  const rett = rowsStd.find((x) => x.method === 'percent_of_cash_land' && typeof x.rate === 'number');
  if (rett) stdEdit(rett.id, `a percentage of cash land (${rett.label}) halved`, (r) => r / 2, true); else out.push({ label: 'a percentage of cash land', skip: 'no row' });
  // A plot's rate and cash share move land value, RETT and the land tables.
  const plot = (st.parcels as any[]).find((pa) => hosts.some((h) => h.landAllocation?.parcelId === pa.id) && pa.rate > 0);
  if (plot) {
    const v = Math.round(plot.rate * 1.1);
    out.push({ movesRevenue: false, label: `land rate of a plot (${plot.name}) +10%`, cell: `parcel:${plot.id}:rate`, value: v, edit: (s) => { (s.parcels as any[]).find((x) => x.id === plot.id).rate = v; } });
    const cash = Math.max(0, Math.min(100, (plot.cashPct ?? 0) - 10));
    out.push({ movesRevenue: false, label: `cash share of a plot (${plot.name}) -10 points`, cell: `parcel:${plot.id}:cash`, value: cash / 100, edit: (s) => { (s.parcels as any[]).find((x) => x.id === plot.id).cashPct = cash; } });
  } else out.push({ label: 'land rate of a plot', skip: 'no plot with a rate' });
  // A plot's spend curve, and a line's own window.
  const curved = (st.assets as any[]).find((a) => a.capexPhasing?.phasing === 'manual' && (a.capexPhasing.distribution ?? []).length > 2 && reg.get(`cxcurve:${a.id}`));
  if (curved) {
    const d = curved.capexPhasing.distribution as number[];
    const i = d.findIndex((x, k) => k > 0 && x > 0);
    const v = d[i] + 10;
    const at = reg.get(`cxcurve:${curved.id}`)!;
    // The curve cell for period i is column C_OPEN + i on the curve row (registered at column 1).
    out.push({ movesRevenue: false, label: `a plot spend curve, period ${i} +10 (${curved.name})`, cell: `cxcurve:${curved.id}`, value: v, col: 6 + i,
      edit: (s) => { (s.assets as any[]).find((x) => x.id === curved.id).capexPhasing.distribution[i] = v; } } as Perturbation);
    void at;
  } else out.push({ label: 'a plot spend curve', skip: 'no curve shown' });
  const fixed = (st.costLines as any[]).find((l) => l.windowFollowsConstruction === false && l.endPeriod >= l.startPeriod && reg.get(`cxwin:${l.id}`) && l.startPeriod >= 1);
  if (fixed) {
    const v = fixed.endPeriod + 1;
    out.push({ movesRevenue: false, label: `a line's own window (${fixed.name}, ${fixed.phaseId}) one period longer`, cell: `cxwin:${fixed.id}`, value: v, col: 4,
      edit: (s) => { (s.costLines as any[]).find((x) => x.id === fixed.id).endPeriod = v; } } as Perturbation);
  } else out.push({ label: "a line's own window", skip: 'no fixed window shown' });

  // ── STAGE 3, REVENUE ──
  const RC = { TOTAL: 4, OPEN: 5 }; const pcol = (t: number): number => RC.OPEN + 1 + t;
  const psy = Number(String(ph.map((q) => q.startDate).sort()[0]).slice(0, 4));
  const lines = planRevenueLines(st.assets, st.subUnits, st.phases, st.project) as any[];
  const earner = (l: any): any => l.members.find((m: any) => (st.subUnits as any[]).some((u) => u.assetId === m.id && u.category !== 'Support'));
  const offOf = (l: any): number => Number(String(ph.find((q) => q.id === l.phaseId).startDate).slice(0, 4)) - psy;
  const sellL = lines.find((l) => l.form === 'sell' && earner(l)?.revenue?.sell);
  if (sellL) {
    const a = earner(sellL); const su = (st.subUnits as any[]).find((u) => u.assetId === a.id && u.category !== 'Support');
    const price = Math.round(su.unitPrice * 1.05);
    out.push({ movesRevenue: true, label: `a Table 5 sale price (${su.name}) +5%`, cell: `su:${su.id}:rate`, value: price,
      edit: (s) => { const u = (s.subUnits as any[]).find((x) => x.id === su.id); u.unitPrice = price; u.pricePerSqm = price; u.priceStated = true; } });
    const vrow = a.revenue.sell.subUnits.find((x: any) => x.subUnitId === su.id);
    const k = (vrow.preSalesVelocityByPhase as number[]).findIndex((v) => v > 0);
    const v = vrow.preSalesVelocityByPhase[k] + 0.05;
    out.push({ movesRevenue: true, label: `a pre-sales velocity (${su.name}, phase year ${k + 1}) +5 points`, cell: `revin|${sellL.key}|Pre-Sales velocity|${su.name}`, col: pcol(offOf(sellL) + k), value: v,
      edit: (s) => { const x = (s.assets as any[]).find((q) => q.id === a.id).revenue.sell.subUnits.find((q: any) => q.subUnitId === su.id); x.preSalesVelocityByPhase[k] = v; if (x.preSalesVelocity) x.preSalesVelocity[offOf(sellL) + k] = v; } });
    const dk = (a.revenue.sell.downpaymentByPhase as any[]).findIndex((d) => typeof d === 'number');
    const dv = a.revenue.sell.downpaymentByPhase[dk] + 0.1;
    out.push({ movesRevenue: true, label: `a sale year's downpayment (phase year ${dk + 1}) +10 points`, cell: `revin|${sellL.key}|Sale cohort terms|Downpayment %`, col: pcol(offOf(sellL) + dk), value: dv,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.sell.downpaymentByPhase[dk] = dv; } });
    out.push({ movesRevenue: true, label: 'instalment years after sale 3 to 2', cell: `revin|${sellL.key}|Sale cohort terms|Max instalment years after sale`, col: RC.TOTAL, value: 2,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.sell.maxInstalmentYears = 2; } });
    const ir = (a.revenue.sell.indexation?.rate ?? 0) + 0.01;
    out.push({ movesRevenue: true, label: 'the sale price indexation rate +1 point', cell: `revfoot|${sellL.key}|idx`, col: RC.TOTAL, value: ir,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.sell.indexation.rate = ir; } });
  } else out.push({ label: 'sell revenue inputs', skip: 'no sell line' });
  const hotL = lines.find((l) => l.form === 'operate' && earner(l)?.revenue?.operate);
  if (hotL) {
    const a = earner(hotL); const op = a.revenue.operate; const off = offOf(hotL);
    const k = (op.occupancyPerPeriodByPhase as number[]).findIndex((v) => v > 0);
    const v = op.occupancyPerPeriodByPhase[k] + 0.05;
    out.push({ movesRevenue: true, label: `hotel occupancy (phase year ${k + 1}) +5 points`, cell: `revin|${hotL.key}|ADR Indexation|Occupancy ramp`, col: pcol(off + k), value: v,
      edit: (s) => { const o = (s.assets as any[]).find((q) => q.id === a.id).revenue.operate; o.occupancyPerPeriodByPhase[k] = v; if (o.occupancyPerPeriod) o.occupancyPerPeriod[off + k] = v; } });
    out.push({ movesRevenue: true, label: 'hotel F&B share of rooms +5 points', cell: `revin|${hotL.key}|ADR Indexation|F&B Revenue, F&B %`, col: RC.TOTAL, value: (op.fb.percentOfRooms ?? 0) + 0.05,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.operate.fb.percentOfRooms = (op.fb.percentOfRooms ?? 0) + 0.05; } });
    out.push({ movesRevenue: true, label: 'hotel days per year 365 to 360', cell: `revfoot|${hotL.key}|days`, col: RC.TOTAL, value: 360,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.operate.daysPerYear = 360; } });
    const tk = a.assetTypeId; const size = st.project.assetTypeValues?.[tk]?.avgUnitSizeSqm;
    if (typeof size === 'number' && reg.get(`type:${tk}:unit`)) {
      out.push({ movesRevenue: true, label: `the hotel type's unit size ${size} to ${size - 10} (the key count moves)`, cell: `type:${tk}:unit`, value: size - 10,
        edit: (s) => { s.project.assetTypeValues![tk].avgUnitSizeSqm = size - 10; } });
    }
    const su = (st.subUnits as any[]).find((u) => u.assetId === a.id && u.category !== 'Support');
    out.push({ movesRevenue: true, label: `the hotel ADR (Table 5) ${su.unitPrice} to ${su.unitPrice + 50}`, cell: `su:${su.id}:rate`, value: su.unitPrice + 50,
      edit: (s) => { const u = (s.subUnits as any[]).find((x) => x.id === su.id); u.unitPrice = su.unitPrice + 50; u.pricePerSqm = su.unitPrice + 50; u.pricePerUnit = su.unitPrice + 50; u.priceStated = true; } });
  } else out.push({ label: 'hotel revenue inputs', skip: 'no hotel line' });
  const leaseL = lines.find((l) => l.form === 'lease' && !l.isStrip && earner(l)?.revenue?.lease);
  if (leaseL) {
    const a = earner(leaseL); const le = a.revenue.lease; const off = offOf(leaseL);
    const k = (le.occupancyPerPeriodByPhase as number[]).findIndex((v) => v > 0);
    const v = le.occupancyPerPeriodByPhase[k] + 0.05;
    out.push({ movesRevenue: true, label: `lease occupancy (${leaseL.label}, phase year ${k + 1}) +5 points`, cell: `revin|${leaseL.key}|Rent Indexation|Occupancy ramp`, col: pcol(off + k), value: v,
      edit: (s) => { const o = (s.assets as any[]).find((q) => q.id === a.id).revenue.lease; o.occupancyPerPeriodByPhase[k] = v; if (o.occupancyPerPeriod) o.occupancyPerPeriod[off + k] = v; } });
    const sy = (le.rentIndexation?.startYear ?? 0) + 1;
    out.push({ movesRevenue: true, label: 'the rent indexation starts a year later', cell: `revfoot|${leaseL.key}|idx`, col: RC.OPEN, value: sy,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.lease.rentIndexation.startYear = sy; } });
    // The operations start shown, one year later: on the platform, an override.
    const cp = ph.find((q) => q.id === leaseL.phaseId).constructionPeriods;
    const shownStart = psy + off + cp;
    out.push({ movesRevenue: true, label: `a lease's operations start one year later (${shownStart + 1})`, cell: `revin|${leaseL.key}|Rent Indexation|Operations start year`, col: RC.TOTAL, value: shownStart + 1,
      edit: (s) => { (s.assets as any[]).find((q) => q.id === a.id).revenue.lease.operationsStartYearOverride = shownStart + 1; } });
  } else out.push({ label: 'lease revenue inputs', skip: 'no lease line' });
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? `\n        ${detail}` : ''}`); }
}

/** Sheets whose figures come out of the circular financing: 1 currency unit, the engine's tolerance. */
const CIRCULAR_SHEETS = new Set<string>([]);
const tolFor = (sheet: string, v: number): number =>
  // EXACT, in money terms: the smaller of half a cent and one part in a billion, never
  // below a millionth of a currency unit, the float noise of summing hundred-million
  // figures in a different order (a check residue the platform holds as -7.45e-9).
  CIRCULAR_SHEETS.has(sheet) ? 1 : Math.max(1e-6, Math.min(0.005, 1e-9 * Math.max(1, Math.abs(v))));

type Num = { key: string; sheet: string; row: number; col: number; v: number };
function numbers(wb: ExcelJS.Workbook): Map<string, Num> {
  const out = new Map<string, Num>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      const raw = cell.value as unknown;
      const v = typeof raw === 'number' ? raw
        : raw && typeof raw === 'object' && 'result' in (raw as object) && typeof (raw as { result: unknown }).result === 'number' ? (raw as { result: number }).result
          : null;
      if (v !== null && Number.isFinite(v)) out.set(cellKey(ws.name, r, c), { key: cellKey(ws.name, r, c), sheet: ws.name, row: r, col: c, v });
    }));
  }
  return out;
}
function formulaCells(wb: ExcelJS.Workbook): Map<string, { formula: string; result: unknown }> {
  const out = new Map<string, { formula: string; result: unknown }>();
  for (const ws of wb.worksheets) ws.eachRow((row, r) => row.eachCell((cell, c) => {
    const raw = cell.value as unknown;
    if (raw && typeof raw === 'object' && 'formula' in (raw as object)) out.set(cellKey(ws.name, r, c), raw as { formula: string; result: unknown });
  }));
  return out;
}

(async () => {
  const input = await loadLiveExportInputs();
  const opts = { state: input.state, projectName: input.projectName, dateLabel: 'verify', caseComparison: input.caseComparison, parties: input.parties, includeSensitivity: true };
  console.log(`Project: ${input.projectName}, version ${input.versionLabel ?? '(unlabelled)'}\n`);

  console.log('=== A. Offline ===');
  const plain = buildModelWorkbook(opts);
  const oracle = numbers(plain);
  const { wb, registry, status, pending: buildPending } = buildFormulaWorkbook(opts);
  const built = numbers(wb);
  const formulas = formulaCells(wb);
  const plainAgain = numbers(buildModelWorkbook(opts));
  let differs = 0;
  for (const [k, n] of oracle) if (plainAgain.get(k)?.v !== n.v) differs++;
  check('A1 the hardcoded export is unchanged and deterministic (built twice, every number equal)', differs === 0 && plainAgain.size === oracle.size, `${differs} differ`);
  check('A2 the hardcoded export contains no formula at all', formulaCells(plain).size === 0);
  let untouchedDiff = 0, cacheDiff = 0; const cacheBad: string[] = [];
  for (const [k, n] of oracle) {
    const b = built.get(k);
    // ExcelJS writes no cached value for a result of 0 (it copies only truthy fields),
    // and the file recalculates on load, so a missing cache over a platform 0 is equal.
    if (formulas.has(k)) { if (!b && n.v === 0) continue; if (!b || Math.abs(b.v - n.v) > tolFor(n.sheet, n.v)) { cacheDiff++; if (cacheBad.length < 5) cacheBad.push(`${k}: cached ${b?.v} vs platform ${n.v}`); } }
    else if (!b || b.v !== n.v) untouchedDiff++;
  }
  check('A3 every cell no layer touched is exactly the hardcoded value', untouchedDiff === 0, `${untouchedDiff} differ`);
  check('A4 every formula caches the platform value', cacheDiff === 0, cacheBad.join('; '));
  const claims: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row, r) => row.eachCell((cell, c) => {
    if (typeof cell.value === 'string' && /hardcoded snapshot/i.test(cell.value)) claims.push(cellKey(ws.name, r, c));
  }));
  check('A5 no cell still claims the workbook is a hardcoded snapshot', claims.length === 0, claims.slice(0, 5).join(', '));
  const unlabelled = [...status].filter(([name, s]) => s.status !== 'front' && s.status !== 'values-by-design' && s.status !== 'values' && !s.note).map(([n]) => n);
  check('A6 every live or partly live sheet says what is live on it', unlabelled.length === 0, unlabelled.join(', '));

  const buf = await enableIterativeCalc((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const calcPr = (await (await JSZip.loadAsync(buf)).file('xl/workbook.xml')!.async('string')).match(/<calcPr[^>]*>/)?.[0] ?? '';
  check('A7 iterative calculation is switched on in the file', /iterate="1"/.test(calcPr), calcPr);
  mkdirSync('exports', { recursive: true });
  const path = `exports/${input.projectName} - Live Model.xlsx`;
  writeFileSync(path, Buffer.from(buf));

  console.log('\n=== Status by sheet ===');
  for (const [name, s] of status) console.log(`  ${name.padEnd(16)} ${s.status.padEnd(17)} formulas ${String(s.formulas).padStart(6)}  ${s.note}`);

  const xl = excelAvailable();
  if (!xl.ok) {
    console.log(`\n[SKIP] B/C need real Excel: ${xl.reason}`);
  } else {
    console.log('\n=== B. Real Excel, before any input is touched ===');
    const t0 = Date.now();
    const rec = recalcInExcel(path);
    console.log(`  (Excel recalculated in ${((Date.now() - t0) / 1000).toFixed(1)}s; iteration ${rec.calc.iteration}, ${rec.calc.maxIterations} passes, max change ${rec.calc.maxChange})`);
    check('B1 Excel opened the file with iterative calculation on', rec.calc.iteration === true);
    const perSheet = new Map<string, { compared: number; bad: string[] }>();
    let errors = 0; const errList: string[] = [];
    for (const [k, n] of oracle) {
      const e = rec.cells.get(k);
      const ps = perSheet.get(n.sheet) ?? { compared: 0, bad: [] }; perSheet.set(n.sheet, ps);
      ps.compared++;
      if (e === undefined) { ps.bad.push(`${k}: missing in Excel (platform ${n.v})`); continue; }
      if (typeof e !== 'number') { ps.bad.push(`${k}: Excel ${JSON.stringify(e)} vs platform ${n.v}`); continue; }
      if (Math.abs(e - n.v) > tolFor(n.sheet, n.v)) ps.bad.push(`${k}: Excel ${e} vs platform ${n.v} (diff ${(e - n.v).toPrecision(4)})`);
    }
    for (const [k, e] of rec.cells) if (typeof e === 'object') { errors++; if (errList.length < 5) errList.push(`${k}: Excel error ${e.error}`); }
    check('B2 no cell recalculates to an Excel error', errors === 0, errList.join('; '));
    // B4. The live cells whose platform value is TEXT (a date written "Dec 2030",
    // a step shown "-") read the same in Excel: a date formula shows that month.
    {
      const cmp = compareLive(plain, plain, wb, rec);
      const bad = [...cmp.bad.filter((x) => x.kind === 'text'), ...cmp.layout.map((a) => ({ addr: a, kind: 'text' as const, msg: `${a}: layout moved on unchanged inputs` }))];
      let n = 0;
      for (const ws of wb.worksheets) ws.eachRow((row, r) => row.eachCell((cell, c) => {
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && 'formula' in (v as object) && typeof plainAt(plain, ws.name, r, c) === 'string') n++;
      }));
      check(`B4 ${n} live cells whose platform value is text (dates, "-", checks, notes) read the same in Excel`, n > 0 && bad.length === 0, bad.slice(0, 6).map((x) => x.msg).join('\n        '));
    }
    // B3. Every figure the platform wrote, sheet by sheet.
    for (const [sheet, ps] of perSheet) {
      const f = rec.formulasBySheet.get(sheet) ?? 0;
      check(`B3 ${sheet}: ${ps.compared} figures recalculate to the platform's (${f} live formulas)`, ps.bad.length === 0, ps.bad.slice(0, 6).join('\n        '));
    }
    // B3b. The checks above are the whole proof, so their NUMBER is pinned to the sheets the platform builds.
    check(`B3b every sheet the platform builds was compared (${perSheet.size})`, perSheet.size >= wb.worksheets.filter((x) => x.state !== 'hidden' && x.name !== 'Cover' && x.name !== 'Guide').length - 1);
    // B0. The comparison FIRES: a copy with one figure deliberately wrong must be
    // caught, at exactly that cell (a check that has only ever passed proves nothing).
    {
      // A figure on a sheet that is still VALUES, so nothing live reads it and exactly one cell can move.
      const victim = [...oracle.values()].find((n) => status.get(n.sheet)?.status === 'values' && Math.abs(n.v) > 1000)!;
      const { wb: bad } = buildFormulaWorkbook(opts);
      bad.getWorksheet(victim.sheet)!.getCell(victim.row, victim.col).value = victim.v + 1;
      const badPath = `exports/${input.projectName} - Live Model (sabotaged copy).xlsx`;
      writeFileSync(badPath, Buffer.from(await enableIterativeCalc((await bad.xlsx.writeBuffer()) as ArrayBuffer)));
      const r2 = recalcInExcel(badPath);
      const caught = [...oracle].filter(([k, n]) => { const e = r2.cells.get(k); return typeof e !== 'number' || Math.abs(e - n.v) > tolFor(n.sheet, n.v); }).map(([k]) => k);
      check('B0 the comparison fires: a copy with one figure off by 1 is caught at exactly that cell', caught.length === 1 && caught[0] === victim.key, caught.slice(0, 3).join(', '));
      const { unlinkSync } = await import('node:fs'); unlinkSync(badPath);
    }
    // C. CHANGE AN INPUT: the platform re-runs on the edited model and Excel
    // recalculates with the same cell typed in; every live cell must agree, and
    // the change must actually move something (a test that moves nothing proves nothing).
    console.log('\n=== C. Real Excel, after an input changes ===');
    // --no-c skips the input changes, for iterating on B; the committed proof runs them.
    if (process.argv.includes('--no-c')) check('C skipped by --no-c (iteration only; never a proof)', false);
    const liveResult = { wb, registry, plain, path, opts, pending: buildPending };
    for (const pt of process.argv.includes('--no-c') ? [] : perturbations(input, registry)) {
      if ('skip' in pt) { check(`C ${pt.label}`, false, `no target on this model: ${pt.skip}`); continue; }
      // The workbook under test: the export itself, or a copy made for a branch the live model lacks.
      let base = liveResult;
      if (pt.variant) {
        const vs = structuredClone(input.snapshot) as Snap; pt.variant(vs);
        const vOpts = { ...opts, state: platformAfterEdit(vs as never) as typeof input.state };
        const built = buildFormulaWorkbook(vOpts);
        const vPath = `exports/${input.projectName} - Live Model (test copy).xlsx`;
        writeFileSync(vPath, Buffer.from(await enableIterativeCalc((await built.wb.xlsx.writeBuffer()) as ArrayBuffer)));
        base = { wb: built.wb, registry: built.registry, plain: buildModelWorkbook(vOpts), path: vPath, opts: vOpts, pending: built.pending };
        const untouched = compareLive(base.plain, base.plain, base.wb, recalcInExcel(vPath));
        check(`C ${pt.label}: the test copy recalculates to the platform before the change`, untouched.bad.length === 0 && untouched.layout.length === 0, untouched.bad.slice(0, 6).map((x) => x.msg).join('\n        '));
      }
      const snap = structuredClone(input.snapshot) as Snap;
      pt.variant?.(snap);
      pt.edit(snap);
      const pOpts = { ...opts, state: platformAfterEdit(snap as never) as typeof input.state };
      const pPlain = buildModelWorkbook(pOpts);
      const a0 = base.registry.need(pt.cell);
      const a = { ...a0, col: pt.col ?? a0.col };
      const r3 = recalcInExcel(base.path, [{ ref: `${a.sheet}!${colLetterOf(a.col)}${a.row}`, value: pt.value }]);
      const cmp = compareLive(base.plain, pPlain, base.wb, r3);
      const bad = cmp.bad;
      // A cell waiting for a later stage may lag an input that moves REVENUE, and only that.
      const hard = bad.filter((x) => !base.pending.has(x.addr));
      const lagging = bad.filter((x) => base.pending.has(x.addr));
      const moved = movedCells(base.plain, pPlain, base.wb);
      const allowed = pt.movesRevenue ? lagging.length : 0;
      check(`C ${pt.label}: ${moved} live cells move on the platform, and Excel agrees on every live cell${pt.movesRevenue ? ` (${lagging.length} marked cells wait for a later stage)` : ''}${cmp.layout.length ? `; ${cmp.layout.length} cells the platform lays out differently after the change (the live workbook keeps its exported layout: ${cmp.layout.slice(0, 4).join(', ')}${cmp.layout.length > 4 ? ', ...' : ''})` : ''}`,
        moved > 0 && hard.length === 0 && lagging.length === allowed,
        [...hard, ...(pt.movesRevenue ? [] : lagging)].slice(0, 8).map((x) => x.msg).join('\n        '));
      if (pt.variant) { const { unlinkSync } = await import('node:fs'); unlinkSync(base.path); }
    }
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
