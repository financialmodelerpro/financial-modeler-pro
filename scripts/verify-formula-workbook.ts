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
    if (formulas.has(k)) { if (!b || Math.abs(b.v - n.v) > tolFor(n.sheet, n.v)) { cacheDiff++; if (cacheBad.length < 5) cacheBad.push(`${k}: cached ${b?.v} vs platform ${n.v}`); } }
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
      if (typeof e !== 'number') { errors++; if (errList.length < 5) errList.push(`${k}: Excel error ${e.error}`); ps.bad.push(`${k}: error`); continue; }
      if (Math.abs(e - n.v) > tolFor(n.sheet, n.v)) ps.bad.push(`${k}: Excel ${e} vs platform ${n.v} (diff ${(e - n.v).toPrecision(4)})`);
    }
    check('B2 no cell recalculates to an Excel error', errors === 0, errList.join('; '));
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
    // C. Perturbations arrive with the first live layer (stage 1).
    void registry;
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
