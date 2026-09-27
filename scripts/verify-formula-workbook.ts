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
import { CellRegistry, setCellSink } from '../src/hubs/modeling/platforms/refm/lib/excel/cellRegistry';
import { platformAfterEdit } from './fixtures/platformAfterEdit';
import type { LiveExportInputs } from './fixtures/liveExportInputs';

const colLetterOf = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Where each quantity lands in the HARDCODED build of a (possibly edited) model. */
const regCache = new WeakMap<object, CellRegistry>();
function oracleRegistry(opts: Parameters<typeof buildModelWorkbook>[0]): CellRegistry {
  const hit = regCache.get(opts); if (hit) return hit;
  const reg = new CellRegistry();
  setCellSink(reg.sink, reg.shift);
  try { buildModelWorkbook(opts); } finally { setCellSink(null); }
  regCache.set(opts, reg); return reg;
}
/** The platform's value for a registered quantity: a number, a text, or undefined (blank). */
function platformValue(plainWb: ExcelJS.Workbook, reg: CellRegistry, key: string): number | string | undefined {
  const a = reg.get(key); if (!a) return undefined;
  const v = plainWb.getWorksheet(a.sheet)!.getCell(a.row, a.col).value as unknown;
  const r = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
  return typeof r === 'number' || typeof r === 'string' ? r : undefined;
}
/** Registered cells that hold a formula in the live workbook. */
function liveKeys(reg: CellRegistry, wb: ExcelJS.Workbook): string[] {
  return reg.keys().filter((k) => {
    const a = reg.need(k);
    const v = wb.getWorksheet(a.sheet)!.getCell(a.row, a.col).value as unknown;
    return !!v && typeof v === 'object' && 'formula' in (v as object);
  });
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (serial: number): string => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** Every live cell, platform against Excel: numbers to the tolerance, text exactly, a month text against a date serial, blank against blank. */
function compareLive(plainWb: ExcelJS.Workbook, oReg: CellRegistry, reg: CellRegistry, wb: ExcelJS.Workbook, rec: ReturnType<typeof recalcInExcel>): Array<{ kind: 'number' | 'text'; msg: string }> {
  const out: Array<{ kind: 'number' | 'text'; msg: string }> = [];
  for (const k of liveKeys(reg, wb)) {
    const a = reg.need(k);
    const o = platformValue(plainWb, oReg, k);
    const e = rec.cells.get(cellKey(a.sheet, a.row, a.col));
    const where = `${k} (${a.sheet}!R${a.row}C${a.col})`;
    if (typeof o === 'number') {
      if (typeof e !== 'number' || Math.abs(e - o) > tolFor(a.sheet, o)) out.push({ kind: 'number', msg: `${where}: Excel ${JSON.stringify(e)} vs platform ${o}` });
    } else if (typeof o === 'string') {
      const ok = typeof e === 'string' ? e.trim() === o.trim()
        : typeof e === 'number' && /^[A-Z][a-z]{2} \d{4}$/.test(o) && monthYear(e) === o;
      if (!ok) out.push({ kind: 'text', msg: `${where}: Excel ${JSON.stringify(e)} vs platform "${o}"` });
    } else if (e !== undefined) {
      out.push({ kind: 'text', msg: `${where}: Excel ${JSON.stringify(e)} vs platform blank` });
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snap = LiveExportInputs['snapshot'] & Record<string, any>;
/** `variant`: the live model has no instance of the branch under test, so a copy is
 *  made that has one (a structural edit, re-run through the platform and exported
 *  afresh) and the input change is tested on THAT workbook. */
type Perturbation = { label: string; cell: string; value: number; edit: (s: Snap) => void; variant?: (s: Snap) => void } | { label: string; skip: string };
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
      label: `plot area of a plot one asset draws whole (${pa.name}${whole ? '' : ', on a copy where its only asset stops typing its draw'}) +10%`,
      cell: `parcel:${pa.id}:area`, value: v,
      edit: (s) => { (s.parcels as any[]).find((p) => p.id === pa.id).area = v; },
      ...(whole ? {} : { variant: (s: Snap) => { const a = assetOf(s, sole.id); delete a.landAllocation.sqm; delete a.landAreaSqm; } }),
    });
  } else out.push({ label: 'plot area of a whole-plot draw', skip: 'no plot has a single asset' });
  // 2. A typed land draw on a retail host (the carve moves with it).
  const typedHost = hosts.find((a) => hostIds.has(a.id) && a.landAllocation?.sqm > 0);
  if (typedHost) {
    const v = Math.round(typedHost.landAllocation.sqm * 0.9);
    out.push({ label: `typed land draw of a retail host (${typedHost.name}) -10%`, cell: `entry:${typedHost.id}:plot`, value: v, edit: (s) => { assetOf(s, typedHost.id).landAllocation.sqm = v; } });
  } else out.push({ label: 'typed land draw of a retail host', skip: 'no retail host draws a typed area' });
  // 3. FAR typed on a retail host.
  const farHost = hosts.find((a) => hostIds.has(a.id) && typeof a.landChain?.farRatio === 'number');
  if (farHost) {
    const v = Math.round(farHost.landChain.farRatio * 1.2 * 100) / 100;
    out.push({ label: `FAR of a retail host (${farHost.name}) +20%`, cell: `entry:${farHost.id}:far`, value: v, edit: (s) => { assetOf(s, farHost.id).landChain.farRatio = v; } });
  } else out.push({ label: 'FAR typed on a retail host', skip: 'none' });
  // 4. Coverage typed on a retail host.
  const covHost = hosts.find((a) => hostIds.has(a.id) && typeof a.landChain?.coveragePct === 'number');
  if (covHost) {
    const pct = Math.max(5, covHost.landChain.coveragePct - 5);
    out.push({ label: `ground coverage of a retail host (${covHost.name}) -5 points`, cell: `entry:${covHost.id}:cov`, value: pct / 100, edit: (s) => { assetOf(s, covHost.id).landChain.coveragePct = pct; } });
  } else out.push({ label: 'coverage typed on a retail host', skip: 'none' });
  // 5. Retail share on a retail host.
  const retHost = hosts.find((a) => hostIds.has(a.id) && (a.landChain?.retailPct ?? 0) > 0);
  if (retHost) {
    const pct = retHost.landChain.retailPct + 5;
    out.push({ label: `retail share of a retail host (${retHost.name}) +5 points`, cell: `entry:${retHost.id}:retail`, value: pct / 100, edit: (s) => { assetOf(s, retHost.id).landChain.retailPct = pct; } });
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
      label: `a type FAR a plot inherits (${donor.name}${inh ? '' : ', on a copy where the plot states none and its type does'}) +15%`,
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
    out.push({ label: 'parking area per slot +5 sqm', cell: 'project:slotArea', value: v, edit: (s) => { s.project.parkingAreaPerSlotSqm = v; } });
  } else out.push({ label: 'parking area per slot', skip: 'not set' });
  // 8. The retail parking ratio the chain reads (resolveRetailSlotArea's rule).
  const rv = st.project.assetTypeValues ?? {};
  const rid = Object.keys(rv).sort().filter((id) => rv[id]?.parkingRatioBasis === 'sqm_per_slot' && rv[id]?.parkingRatio > 0);
  const slotId = rid.includes('retail-ground-floor') ? 'retail-ground-floor' : rid.length === 1 ? rid[0] : undefined;
  if (slotId && strips.length) {
    const listed = (st.project.assetTypes ?? []).some((t: any) => t.id === slotId);
    const v = rv[slotId].parkingRatio + 10;
    out.push({ label: `retail sqm per parking slot +10 (held by ${slotId}${listed ? '' : ', a type not in the list'})`, cell: listed ? `type:${slotId}:ratio` : 'project:retailSlotArea', value: v, edit: (s) => { s.project.assetTypeValues![slotId].parkingRatio = v; } });
  } else out.push({ label: 'retail sqm per parking slot', skip: 'no retail strip or no ratio' });
  // 9. A phase's construction period, and 10. a later phase's start date.
  const ph = st.phases as any[];
  out.push({ label: `construction years of ${ph[0].name} +1`, cell: `phase:${ph[0].id}:cp`, value: ph[0].constructionPeriods + 1, edit: (s) => { (s.phases as any[])[0].constructionPeriods = ph[0].constructionPeriods + 1; } });
  const earliest = ph.reduce((m, q) => (q.startDate < m ? q.startDate : m), ph[0].startDate);
  const later = ph.find((p) => p.startDate > earliest);
  if (later) {
    const d = new Date(`${later.startDate.slice(0, 10)}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1);
    const iso = d.toISOString().slice(0, 10);
    const serial = Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
    out.push({ label: `start date of ${later.name} one year later`, cell: `phase:${later.id}:start`, value: serial, edit: (s) => { (s.phases as any[]).find((p) => p.id === later.id).startDate = iso; } });
  } else out.push({ label: 'start date of a later phase', skip: 'one phase, or all start together' });
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
  CIRCULAR_SHEETS.has(sheet) ? 1 : Math.max(1e-9, Math.min(0.005, 1e-9 * Math.max(1, Math.abs(v))));

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
  const { wb, registry, status } = buildFormulaWorkbook(opts);
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
      const oReg = oracleRegistry(opts);
      const bad = compareLive(plain, oReg, registry, wb, rec).filter((x) => x.kind === 'text');
      const n = liveKeys(registry, wb).filter((k) => typeof platformValue(plain, oReg, k) === 'string').length;
      check(`B4 ${n} live cells whose platform value is text (dates, "-") read the same in Excel`, n > 0 && bad.length === 0, bad.slice(0, 6).map((x) => x.msg).join('\n        '));
    }
    for (const [sheet, ps] of perSheet) {
      const f = rec.formulasBySheet.get(sheet) ?? 0;
      check(`B3 ${sheet}: ${ps.compared} figures recalculate to the platform's (${f} live formulas)`, ps.bad.length === 0, ps.bad.slice(0, 6).join('\n        '));
    }
    // B0. The comparison FIRES: a copy with one figure deliberately wrong must be
    // caught, at exactly that cell (a check that has only ever passed proves nothing).
    {
      const victim = [...oracle.values()].find((n) => n.sheet === 'Capex' && Math.abs(n.v) > 1000)!;
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
    const oReg0 = oracleRegistry(opts);
    const variants = new Map<Perturbation, { wb: ExcelJS.Workbook; registry: CellRegistry; plain: ExcelJS.Workbook; oReg: CellRegistry; path: string; opts: typeof opts }>();
    for (const pt of perturbations(input, registry)) {
      if ('skip' in pt) { check(`C ${pt.label}`, false, `no target on this model: ${pt.skip}`); continue; }
      // The workbook under test: the export itself, or a copy made for a branch the live model lacks.
      let base = { wb, registry, plain, oReg: oReg0, path, opts };
      if (pt.variant) {
        const vs = structuredClone(input.snapshot) as Snap; pt.variant(vs);
        const vOpts = { ...opts, state: platformAfterEdit(vs as never) as typeof input.state };
        const built = buildFormulaWorkbook(vOpts);
        const vPath = `exports/${input.projectName} - Live Model (test copy).xlsx`;
        writeFileSync(vPath, Buffer.from(await enableIterativeCalc((await built.wb.xlsx.writeBuffer()) as ArrayBuffer)));
        base = { wb: built.wb, registry: built.registry, plain: buildModelWorkbook(vOpts), oReg: oracleRegistry(vOpts), path: vPath, opts: vOpts };
        variants.set(pt, base);
        const untouched = compareLive(base.plain, base.oReg, base.registry, base.wb, recalcInExcel(vPath));
        check(`C ${pt.label}: the test copy recalculates to the platform before the change`, untouched.length === 0, untouched.slice(0, 6).map((x) => x.msg).join('\n        '));
      }
      const snap = structuredClone(input.snapshot) as Snap;
      pt.variant?.(snap);
      pt.edit(snap);
      const pOpts = { ...opts, state: platformAfterEdit(snap as never) as typeof input.state };
      const pPlain = buildModelWorkbook(pOpts);
      const pReg = oracleRegistry(pOpts);
      const a = base.registry.need(pt.cell);
      const r3 = recalcInExcel(base.path, [{ ref: `${a.sheet}!${colLetterOf(a.col)}${a.row}`, value: pt.value }]);
      const bad = compareLive(pPlain, pReg, base.registry, base.wb, r3);
      const moved = liveKeys(base.registry, base.wb).filter((k) => {
        const before = platformValue(base.plain, base.oReg, k), after = platformValue(pPlain, pReg, k);
        return typeof before === 'number' && typeof after === 'number' ? Math.abs(before - after) > 1e-6 : before !== after;
      }).length;
      check(`C ${pt.label}: ${moved} live cells move on the platform, and Excel agrees on every live cell`, moved > 0 && bad.length === 0,
        bad.slice(0, 8).map((x) => x.msg).join('\n        '));
      if (pt.variant) { const { unlinkSync } = await import('node:fs'); unlinkSync(base.path); }
    }
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
