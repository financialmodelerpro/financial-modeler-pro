/**
 * excelRecalc.ts (2026-09-27)
 *
 * Node side of scripts/excel-recalc.ps1: recalculate a workbook in REAL Excel
 * (optionally after setting input cells) and return every numeric and error
 * cell, keyed "Sheet!R<row>C<col>".
 *
 * Excel is needed, so this runs where Excel is installed (the founder's Windows
 * machine), not on Vercel or a machine without it; `excelAvailable()` says
 * which, and callers report a named skip rather than a pass.
 *
 * No em dashes in this file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ExcelRecalc {
  calc: { iteration: boolean; maxIterations: number; maxChange: number };
  /** "Sheet!R12C6" -> number, or { error: code } */
  cells: Map<string, number | { error: number }>;
  formulasBySheet: Map<string, number>;
}

export function excelAvailable(): { ok: true } | { ok: false; reason: string } {
  if (process.platform !== 'win32') return { ok: false, reason: 'not Windows (Excel automation needs Windows with Excel installed)' };
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "try { $x = New-Object -ComObject Excel.Application -ErrorAction Stop; $v = $x.Version; $x.Quit(); 'ok ' + $v } catch { 'no ' + $_.Exception.Message }"],
    { encoding: 'utf8', timeout: 60_000 }).trim();
    return out.startsWith('ok') ? { ok: true } : { ok: false, reason: `Excel is not installed or not scriptable (${out})` };
  } catch (e) {
    return { ok: false, reason: `Excel check failed: ${(e as Error).message}` };
  }
}

export const cellKey = (sheet: string, row: number, col: number): string => `${sheet}!R${row}C${col}`;

export function recalcInExcel(xlsxPath: string, sets: Array<{ ref: string; value: number }> = []): ExcelRecalc {
  const dir = mkdtempSync(join(tmpdir(), 'fmp-xl-'));
  const out = join(dir, 'cells.tsv');
  try {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/excel-recalc.ps1'), '-Path', resolve(xlsxPath), '-OutPath', out];
    if (sets.length) args.push('-Sets', sets.map((s) => `${s.ref}=${s.value}`).join(';'));
    execFileSync('powershell.exe', args, { encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    const lines = readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean);
    const res: ExcelRecalc = { calc: { iteration: false, maxIterations: 0, maxChange: 0 }, cells: new Map(), formulasBySheet: new Map() };
    for (const l of lines) {
      const p = l.split('\t');
      if (p[0] === '#calc') {
        const kv = Object.fromEntries(p.slice(1).map((x) => x.split('=')));
        res.calc = { iteration: kv.iteration === 'True', maxIterations: Number(kv.maxIterations), maxChange: Number(kv.maxChange) };
      } else if (p[0] === '#formulas') res.formulasBySheet.set(p[1], Number(p[2]));
      else res.cells.set(cellKey(p[0], Number(p[1]), Number(p[2])), p[3] === 'n' ? Number(p[4]) : { error: Number(p[4]) });
    }
    return res;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
