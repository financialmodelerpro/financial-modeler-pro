/**
 * probe-formula-workbook-projects.ts (2026-11-07)
 *
 * THE LIVE WORKBOOK ON EVERY OPEN PROJECT, AS THE EXPORT ROUTE WOULD BUILD IT.
 * For each open project (latest saved version, assembled exactly as the route
 * does): whether it builds, is refused (and why, in the user's words), each
 * sheet's status, formulas over 200 characters by sheet, and then the file
 * recalculated in headless LibreOffice and in real Excel: every error cell and
 * every status on the Checks tab.
 *
 * A probe, not a verifier: it reports, it does not gate. Run with credentials:
 *   npx tsx --env-file=.env.local scripts/probe-formula-workbook-projects.ts [--no-excel] [--no-libre] [--only <id>]
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { buildFormulaWorkbook, enableFormulaIteration } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { liveWorkbookRefusal, emptyProjectRefusal } from '../src/hubs/modeling/platforms/refm/lib/excel/liveWorkbookAvailability';
import { loadLiveExportInputs } from './fixtures/liveExportInputs';
import { excelAvailable, recalcInExcel } from './excelRecalc';

const args = process.argv.slice(2);
const noExcel = args.includes('--no-excel');
const noLibre = args.includes('--no-libre');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const OUT = resolve('.probe-live-workbooks');
const SOFFICE = join(process.env.LOCALAPPDATA ?? '', 'LibreOfficeExtract', 'program', 'soffice.exe');
const LONG = 200;

function libreProfile(): string {
  const dir = join(OUT, 'lo-profile');
  const user = join(dir, 'user');
  mkdirSync(user, { recursive: true });
  // Recalculate every formula on load (OOXMLRecalcMode 0 = always), so the stored values are not trusted.
  writeFileSync(join(user, 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
  return 'file:///' + dir.replace(/\\/g, '/');
}

/** Recalculate in LibreOffice and read back every formula's result. */
async function libreRecalc(xlsx: string): Promise<{ errors: string[]; checks: Map<string, string> }> {
  const outDir = join(OUT, 'lo-out');
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
  execFileSync(SOFFICE, [`-env:UserInstallation=${libreProfile()}`, '--headless', '--norestore', '--calc', '--convert-to', 'xlsx', '--outdir', outDir, xlsx], { timeout: 600_000, stdio: 'pipe' });
  const name = xlsx.split(/[\\/]/).pop()!;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(outDir, name));
  const errors: string[] = []; const checks = new Map<string, string>();
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as { formula?: string; result?: unknown } | null;
    const res = v && typeof v === 'object' && 'formula' in v ? v.result : c.value;
    const err = res && typeof res === 'object' && 'error' in (res as object) ? String((res as { error: string }).error) : null;
    if (err) errors.push(`${ws.name}!${c.address} ${err}`);
    if (ws.name === 'Checks' && (res === 'OK' || res === 'CHECK' || res === 'NOTE')) checks.set(`${ws.name}!${c.address}`, res as string);
  }));
  return { errors, checks };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from('refm_projects').select('id, name, archived').is('deleted_at', null).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const projects = (data ?? []).filter((p) => !p.archived && (!only || p.id === only));
  const xl = noExcel ? { ok: false as const, reason: '--no-excel' } : excelAvailable();
  const lo = !noLibre && existsSync(SOFFICE);
  console.log(`Open projects: ${projects.length}. Excel: ${xl.ok ? 'yes' : `no (${(xl as { reason: string }).reason})`}. LibreOffice: ${lo ? 'yes' : 'no'}.`);
  for (const p of projects) {
    console.log(`\n=== ${p.name} (${p.id})`);
    let inputs;
    try { inputs = await loadLiveExportInputs(p.id); } catch (e) { console.log(`  NOT EXPORTED: ${(e as Error).message}`); continue; }
    const opts = { state: inputs.state, projectName: inputs.projectName, dateLabel: '7 November 2026', caseComparison: inputs.caseComparison, parties: inputs.parties } as Parameters<typeof buildFormulaWorkbook>[0];
    const nAssets = ((inputs.state as { assets?: Array<{ visible?: boolean }> }).assets ?? []).filter((a) => a.visible !== false).length;
    const empty = emptyProjectRefusal(nAssets);
    if (empty) console.log(`  Route decision: REFUSED (no assets) -> "${empty.message}"`);
    let res;
    try { res = buildFormulaWorkbook(opts); } catch (e) { console.log(`  BUILD REFUSED BY ITS OWN CHECKS: ${(e as Error).message.slice(0, 300)}`); continue; }
    // The route's own order: an empty project first, then the build's financing status.
    const assets = ((inputs.state as { assets?: Array<{ visible?: boolean }> }).assets ?? []).filter((a) => a.visible !== false).length;
    const refusal = emptyProjectRefusal(assets) ?? liveWorkbookRefusal(res.status);
    console.log(`  Route decision: ${refusal ? `REFUSED -> "${refusal.message}"` : 'BUILDS'}`);
    let formulas = 0; const longBy = new Map<string, number>(); let longest = 0;
    for (const ws of res.wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
      formulas++; longest = Math.max(longest, v.formula.length);
      if (v.formula.length > LONG) longBy.set(ws.name, (longBy.get(ws.name) ?? 0) + 1);
    }));
    const byStatus = new Map<string, string[]>();
    for (const [s, st] of res.status) if (st.status !== 'front') byStatus.set(st.status, [...(byStatus.get(st.status) ?? []), s]);
    for (const [k, v] of byStatus) console.log(`  ${k}: ${v.join(', ')}`);
    for (const [s, st] of res.status) if (st.status === 'values' || st.status === 'partial') console.log(`    [${s}] ${st.note.slice(0, 400)}`);
    console.log(`  Formulas: ${formulas}; longest ${longest}; over ${LONG}: ${[...longBy.values()].reduce((a, b) => a + b, 0)} ${JSON.stringify(Object.fromEntries(longBy))}`);
    const safe = p.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    const file = join(OUT, `${safe}.xlsx`);
    const buf = await res.wb.xlsx.writeBuffer();
    writeFileSync(file, Buffer.from(await enableFormulaIteration(buf as ArrayBuffer)));
    // The stored statuses (what the file shows on opening).
    const stored = new Map<string, string>();
    res.wb.getWorksheet('Checks')?.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { result?: unknown } | string | null;
      const r = v && typeof v === 'object' ? v.result : v;
      if (r === 'OK' || r === 'CHECK' || r === 'NOTE') stored.set(`Checks!${c.address}`, r as string);
    }));
    const tally = (m: Map<string, string>): string => ['OK', 'CHECK', 'NOTE'].map((s) => `${s} ${[...m.values()].filter((x) => x === s).length}`).join(', ');
    console.log(`  Checks as stored: ${tally(stored)}${[...stored].filter(([, s]) => s !== 'OK').map(([k, s]) => ` ${k}=${s}`).join('')}`);
    if (lo) {
      try {
        const r = await libreRecalc(file);
        console.log(`  LibreOffice: errors ${r.errors.length}${r.errors.length ? ` (${r.errors.slice(0, 6).join(', ')})` : ''}; checks ${tally(r.checks)}${[...r.checks].filter(([, s]) => s !== 'OK').map(([k, s]) => ` ${k}=${s}`).join('')}`);
      } catch (e) { console.log(`  LibreOffice FAILED: ${(e as Error).message.slice(0, 300)}`); }
    }
    if (xl.ok) {
      try {
        const r = recalcInExcel(file);
        const errs = [...r.cells].filter(([, v]) => typeof v === 'object').map(([k, v]) => `${k} #${(v as { error: number }).error}`);
        const checks = new Map([...r.cells].filter(([k, v]) => k.startsWith('Checks!') && (v === 'OK' || v === 'CHECK' || v === 'NOTE')) as Array<[string, string]>);
        console.log(`  Excel: iteration ${r.calc.iteration}; errors ${errs.length}${errs.length ? ` (${errs.slice(0, 6).join(', ')})` : ''}; checks ${tally(checks)}${[...checks].filter(([, s]) => s !== 'OK').map(([k, s]) => ` ${k}=${s}`).join('')}`);
      } catch (e) { console.log(`  Excel FAILED: ${(e as Error).message.slice(0, 300)}`); }
    }
  }
  void readFileSync;
}

main().catch((e) => { console.error(e); process.exit(1); });
