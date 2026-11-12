/**
 * export-workbooks.ts
 *
 * Export BOTH Excel workbooks of the live project (the values workbook and the
 * live formula workbook) into `exports/`, in the units chosen, built from the
 * one saved-version load path the verifier uses (`loadLiveExportInputs`). Then,
 * unless --no-libre, recalculate the live workbook in headless LibreOffice and
 * report every error cell and every Checks verdict.
 *
 * Written 2026-11-12 for the export simplification (docs/EXPORT_SIMPLIFICATION_PLAN.md):
 * each step ends with both files exported for review in every unit.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/export-workbooks.ts [--scale full|thousands|millions|all] [--no-libre] [--dump <file.json>]
 *
 * --dump writes every cell's value (sheet!address -> value) for both workbooks,
 * so a before / after pair proves a formatting change moved no figure.
 *
 * `exports/` is gitignored: these carry real project data. No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateModelWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { generateLiveWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { loadLiveExportInputs } from './fixtures/liveExportInputs';
import type { DisplayScale } from '../src/hubs/modeling/platforms/refm/lib/excel/styles';

const args = process.argv.slice(2);
const arg = (k: string): string | null => (args.includes(k) ? args[args.indexOf(k) + 1] ?? null : null);
const scaleArg = arg('--scale') ?? 'full';
const SCALES: DisplayScale[] = scaleArg === 'all' ? ['full', 'thousands', 'millions'] : [scaleArg as DisplayScale];
const noLibre = args.includes('--no-libre');
const dumpFile = arg('--dump');
const OUT = resolve('exports');
const SOFFICE = join(process.env.LOCALAPPDATA ?? '', 'LibreOfficeExtract', 'program', 'soffice.exe');

function libreProfile(): string {
  const dir = join(OUT, '.lo-profile');
  const user = join(dir, 'user');
  mkdirSync(user, { recursive: true });
  // Recalculate every formula on load, so no stored value is trusted.
  writeFileSync(join(user, 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
  return 'file:///' + dir.replace(/\\/g, '/');
}

/** Recalculate in LibreOffice; every error cell, every Checks verdict, and the largest gap from the stored value. */
async function libreRecalc(xlsx: string, stored: ExcelJS.Workbook): Promise<{ errors: string[]; verdicts: Record<string, number>; notOk: string[]; maxGap: { at: string; gap: number } }> {
  const outDir = join(OUT, '.lo-out');
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
  execFileSync(SOFFICE, [`-env:UserInstallation=${libreProfile()}`, '--headless', '--norestore', '--calc', '--convert-to', 'xlsx', '--outdir', outDir, xlsx], { timeout: 900_000, stdio: 'pipe' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(outDir, xlsx.split(/[\\/]/).pop()!));
  const errors: string[] = []; const verdicts: Record<string, number> = {}; const notOk: string[] = [];
  let maxGap = { at: '', gap: 0 };
  for (const ws of wb.worksheets) {
    const orig = stored.getWorksheet(ws.name);
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string; result?: unknown } | null;
      const res = v && typeof v === 'object' && 'formula' in v ? v.result : c.value;
      if (res && typeof res === 'object' && 'error' in (res as object)) errors.push(`${ws.name}!${c.address} ${(res as { error: string }).error}`);
      if (ws.name === 'Checks' && (res === 'OK' || res === 'CHECK' || res === 'NOTE')) {
        verdicts[res] = (verdicts[res] ?? 0) + 1;
        if (res === 'CHECK') notOk.push(`${c.address}: ${String(row.getCell(1).value ?? row.getCell(2).value ?? '')}`.slice(0, 160));
      }
      const o = orig?.getCell(c.address).value as { result?: unknown } | number | null | undefined;
      const ov = o && typeof o === 'object' && 'result' in o ? o.result : o;
      if (typeof res === 'number' && typeof ov === 'number') {
        const gap = Math.abs(res - ov) / Math.max(1, Math.abs(ov));
        if (gap > maxGap.gap) maxGap = { at: `${ws.name}!${c.address}`, gap };
      }
    }));
  }
  return { errors, verdicts, notOk, maxGap };
}

function dumpValues(wb: ExcelJS.Workbook): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as { formula?: string; result?: unknown } | null;
    const res = v && typeof v === 'object' && 'formula' in v ? v.result : v;
    if (typeof res === 'number' || typeof res === 'string' || typeof res === 'boolean') out[`${ws.name}!${c.address}`] = res;
  }));
  return out;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const live = await loadLiveExportInputs();
  const base = live.projectName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const dump: Record<string, unknown> = {};
  let failed = false;
  for (const scale of SCALES) {
    const common = {
      state: live.state, projectName: live.projectName, dateLabel, displayScale: scale,
      caseComparison: live.caseComparison ?? undefined, parties: live.parties as never, includeSensitivity: true,
    };
    const valuesBuf = await generateModelWorkbookBuffer(common);
    const valuesPath = join(OUT, `${base}_Values_${scale}.xlsx`);
    writeFileSync(valuesPath, Buffer.from(valuesBuf));
    const built = await generateLiveWorkbook(common);
    if (!built.ok) { console.error(`FAIL live workbook refused (${scale}): ${built.message} ${built.detail}`); process.exit(1); }
    const livePath = join(OUT, `${base}_Live_${scale}.xlsx`);
    writeFileSync(livePath, Buffer.from(built.buffer));
    console.log(`wrote ${valuesPath}\nwrote ${livePath}`);

    const valuesWb = new ExcelJS.Workbook(); await valuesWb.xlsx.load(valuesBuf);
    const liveWb = new ExcelJS.Workbook(); await liveWb.xlsx.load(built.buffer);
    for (const [k, wb] of [['values', valuesWb], ['live', liveWb]] as const) {
      const rows = wb.worksheets.map((ws) => `${ws.name} ${ws.actualRowCount}`).join(', ');
      console.log(`  ${k} (${scale}): ${wb.worksheets.length} tabs; rows: ${rows}`);
    }
    if (dumpFile && scale === SCALES[0]) { dump.values = dumpValues(valuesWb); dump.live = dumpValues(liveWb); }

    if (!noLibre && scale === SCALES[0]) {
      if (!existsSync(SOFFICE)) { console.error(`FAIL LibreOffice not found at ${SOFFICE}`); failed = true; continue; }
      const r = await libreRecalc(livePath, liveWb);
      console.log(`  LibreOffice recalc: ${r.errors.length} error cells${r.errors.length ? ` (${r.errors.slice(0, 8).join(', ')})` : ''}; Checks ${JSON.stringify(r.verdicts)}; largest gap from stored ${r.maxGap.gap.toExponential(2)} at ${r.maxGap.at}`);
      for (const n of r.notOk) console.log(`    CHECK ${n}`);
      if (r.errors.length || r.notOk.length) failed = true;
    }
  }
  if (dumpFile) writeFileSync(dumpFile, JSON.stringify(dump));
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
