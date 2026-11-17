/**
 * verify-export-vs-reference.ts (2026-11-17, founder: "make the export match the reference file exactly")
 *
 * THE REFERENCE is the live export of the reference project, restyled by hand and saved by Excel. It is a
 * local, gitignored file (docs/refm-export-reference.xlsx) and is never committed, so this verifier SKIPS with
 * a message when it is absent (CI has no copy) and compares cell for cell when it is present:
 *
 *   A. the live export: tab order; per tab the column widths, freeze panes, merges, row heights, print setup,
 *      conditional formats, and per cell the value or formula text, the formula's result (within 1e-6), the
 *      number format, font, fill, border and alignment.
 *   B. the values export: the same structure (tabs, widths, freeze, merges, heights, styles, labels), its
 *      figures against the live file's results, not formulas.
 *
 * A DIFFERENCE THE FOUNDER ASKED FOR is named in ACCEPTED below with its reason, cell by cell; nothing else is
 * excused, and an accepted difference that no longer occurs fails too (so the list cannot go stale).
 *
 * Flags: --file <live.xlsx> [--values <values.xlsx>] compares exported files instead of building; --tab <name>
 * limits the report; --all prints every difference (default: the first 40 per tab and category).
 *
 * No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';

const REF_PATH = 'docs/refm-export-reference.xlsx';
const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_TAB = arg('--tab');
const SHOW_ALL = argv.includes('--all');

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? `\n         ${detail.split('\n').join('\n         ')}` : ''}`); }
}

/**
 * THE FOUNDER'S OWN CHANGES TO THE REFERENCE (2026-11-17 prompt), each a cell or a rule the reference does not
 * carry. Key: "Tab!A1" or "Tab!*" with a category; the reason is printed.
 */
// mayNotOccur: an entry that depends on the day (the export date matches the reference's on the day it was made).
const ACCEPTED: Array<{ at: RegExp; cat?: RegExp; why: string; mode?: 'live' | 'values'; mayNotOccur?: boolean }> = [
  // 7. "Guide section 3 wording adjusted for values (no iterative calc needed)"; and the values file says it was exported
  // with its values, not with live formulas.
  { at: /^Guide![C-K]25$/, cat: /^value$/, why: 'the values file needs no iterative calculation (Guide section 3)', mode: 'values' },
  { at: /^Guide![D-K]17$/, cat: /^value$/, why: 'the values file is exported with its values, not live formulas', mode: 'values' },
  // 4. "Risk flag TRIGGERS: move them off the Dashboard to a new Inputs section 12 ... The Dashboard reads them
  // with green links." The reference types them on the Dashboard (yellow inputs).
  { at: /^Dashboard![KL](3[2-9]|4[0-4])$/, cat: /value|font|fill|border|numFmt|formula/, why: 'risk triggers are links to Inputs section 12, not typed on the Dashboard' },
  // 4. "Key messages must adapt to each project": the reference's tile counted back from the exit year by a typed 11
  // (wrong once the exit year moves); ours reads the first model year. The figure it shows is the same.
  { at: /^Dashboard!C9$/, cat: /^formula$/, why: 'the tile reads the first model year instead of the exit year less a typed 11' },
  // "no project names ... or asset types typed in": the reference typed "Villa" and "villas / hotel"; ours takes the
  // type's own name from the platform.
  { at: /^Dashboard!C(25|32)$/, cat: /^value$/, why: 'the assumption labels name the line types as the platform names them' },
  // The risk triggers moved to Inputs (founder): the note under the flags and the Guide's "What to change" say so.
  { at: /^Dashboard!G45$/, cat: /^value$/, why: 'the triggers are inputs on Inputs, not on the Dashboard' },
  { at: /^Guide![D-K]27(\(ours 28\))?$/, cat: /^value$/, why: 'the triggers are inputs on Inputs, not on the Dashboard' },
  // 8. "document it in the Guide section 3": the circularity switch's row, under "Iterative calculation" (live file).
  { at: /^Guide!(row26|D26)$/, cat: /^(extra|merge)$/, why: 'Guide section 3 says how to use the circularity switch', mode: 'live' },
  // 8. "Financing 'Cash above the minimum, before the sweep': no Total (it sums to 1,785m, which means nothing)".
  { at: /^Financing!F100\(ours 99\)$/, cat: /^(formula|value|result|numFmt)$/, why: 'a balance-like row takes no Total (founder, open fix 8)' },
  // 8. "If it drifts, add a circularity switch on Inputs (1 = on), with interest using the switch": a cold start drifted
  // (every loop held #VALUE!), so interest, the sweep, the fund fees total and the zakat read back from the P&L each
  // read the switch (IF(switch=1, ..., 0)), and the switch sits on Inputs (section 13, below the reference's rows).
  // The phase EBITDA links (each phase's dividend cap reads its P&L) are read back from the P&L too, and cut the same way.
  { at: /^Financing![G-S](41|43|74|86|104|106)\(ours (40|42|73|85|103|105)\)$/, cat: /^formula$/, why: 'the circularity switch cuts the financing loops (open fix 8, TRAPS 3.46)' },
  // Print set-up (2026-11-17, founder): the Cover on one page; the Guide fitted to the width on two pages.
  { at: /^(Cover|Guide)!print$/, cat: /^print$/, why: 'the Cover prints on one page and the Guide on two (founder)' },
  // The Dashboard at a fixed scale, fit off, so Excel keeps its two manual breaks: three pages in real Excel (founder).
  { at: /^Dashboard!print$/, cat: /^print$/, why: 'the Dashboard prints on three pages at a fixed scale (founder)' },
  // The export date on the Cover is the day the file is made.
  { at: /^Cover!D12$/, cat: /^value$/, why: 'the Cover states the day the file is exported', mayNotOccur: true },
  // 6. The Cover footer: the reference wrote it navy on its navy band, which cannot be read; ours is white and pale.
  { at: /^Cover!C(39|40)$/, cat: /^font$/, why: 'the Cover footer is readable on its navy band (the reference wrote it navy on navy)' },
  // 1. "Freeze panes G7 on every time tab (Returns too)": the reference froze Returns at G6.
  { at: /^Returns!freeze$/, why: 'freeze panes G7 on every time tab, Returns too' },
];

/**
 * ROWS THE FOUNDER MOVED (2026-11-17 prompt): a reference row to the row it is on in ours (null: not in ours), and
 * every reference formula's references to that tab are moved the same way before they are compared.
 *   Financing: "Remove any double blank rows (Financing section 3 has one now)": the blank row under the Senior
 *     debt bar (reference row 35) goes, so every row under it sits one higher.
 *   Inputs: section 12, Dashboard risk triggers, is added after section 11, so the reference's closing blank row and
 *     End of sheet band sit under it (its rows are checked by the Dashboard links that read them).
 */
const rowShift = new Map<string, (r: number) => number | null>();
function setRowShifts(ref: ExcelJS.Workbook, ours: ExcelJS.Workbook): void {
  rowShift.set('Financing', (r) => (r === 35 ? null : r > 35 ? r - 1 : r));
  // Guide section 3 of the live file says how to use the circularity switch (open fix 8): one row more, after the
  // reference's "Iterative calculation" row 25. The values file needs no switch, so its Guide keeps the reference's rows.
  rowShift.set('Guide', (r) => (mode === 'live' && r >= 26 ? r + 1 : r));
  const endOf = (ws?: ExcelJS.Worksheet): number => { let e = 0; ws?.eachRow((row, r) => { if (row.getCell(2).value === 'End of sheet') e = r; }); return e; };
  const re = endOf(ref.getWorksheet('Inputs')), oe = endOf(ours.getWorksheet('Inputs'));
  if (re && oe) rowShift.set('Inputs', (r) => (r < re - 1 ? r : oe - (re - r)));
}
const COLR = /(?<![A-Za-z0-9_.$!'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*)!)?(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![A-Za-z0-9_(!])/g;
/** A reference formula with its references to a moved tab's rows moved as the tab's rows were. */
function shiftRefFormula(f: string, own: string): string {
  return f.split(/("(?:[^"]|"")*")/).map((seg, i) => (i % 2 ? seg : seg.replace(COLR, (all, q: string | undefined, col: string, row: string, col2?: string, row2?: string) => {
    // The second end of a range is on the first end's tab.
    const sheet = q ? q.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : own;
    const sh = rowShift.get(sheet);
    if (!sh) return all;
    const to = sh(Number(row)) ?? Number(row), to2 = row2 ? sh(Number(row2)) ?? Number(row2) : null;
    return `${q ?? ''}${col}${to}${col2 && to2 !== null ? `:${col2}${to2}` : ''}`;
  }))).join('');
}
const used = new Set<number>();
let mode: 'live' | 'values' = 'live';
function accepted(at: string, cat: string): boolean {
  for (let i = 0; i < ACCEPTED.length; i++) {
    const a = ACCEPTED[i];
    if (a.mode && a.mode !== mode) continue;
    if (a.at.test(at) && (!a.cat || a.cat.test(cat))) { used.add(i); return true; }
  }
  return false;
}

/** ExcelJS cannot read a workbook with charts; take the drawings out (cells, styles and formats are untouched). */
async function loadWithoutDrawings(buf: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const z = await JSZip.loadAsync(buf);
  for (const n of Object.keys(z.files)) {
    if (z.files[n].dir) continue;
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) {
      const s = await z.file(n)!.async('string');
      z.file(n, s.replace(/<drawing [^>]*\/>/g, '').replace(/<legacyDrawing [^>]*\/>/g, ''));
    }
    if (/^xl\/worksheets\/_rels\//.test(n)) {
      const s = await z.file(n)!.async('string');
      z.file(n, s.replace(/<Relationship [^>]*Type="[^"]*\/(drawing|vmlDrawing|comments)"[^>]*\/>/g, ''));
    }
  }
  for (const n of Object.keys(z.files)) if (/^xl\/(drawings|charts|comments)\//.test(n)) z.remove(n);
  const ct = await z.file('[Content_Types].xml')!.async('string');
  z.file('[Content_Types].xml', ct.replace(/<Override [^>]*PartName="\/xl\/(drawings|charts|comments)[^>]*\/>/g, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await z.generateAsync({ type: "nodebuffer" })) as never);
  return wb;
}

/** The charts of a workbook (sheet, anchor, type, series ranges), read from the package. */
async function chartsOf(buf: Buffer | ArrayBuffer): Promise<string[]> {
  const z = await JSZip.loadAsync(buf);
  const out: string[] = [];
  for (const n of Object.keys(z.files).filter((x) => /^xl\/charts\/chart\d+\.xml$/.test(x)).sort()) {
    const s = await z.file(n)!.async('string');
    const kinds = [...s.matchAll(/<c:(barChart|lineChart|pieChart|areaChart|scatterChart|doughnutChart)>/g)].map((m) => m[1]);
    const refs = [...s.matchAll(/<c:f>([^<]+)<\/c:f>/g)].map((m) => m[1]);
    out.push(`${kinds.join('+')} ${refs.join(' ')}`);
  }
  return out;
}

const isF = (v: unknown): v is { formula?: string; sharedFormula?: string; result?: unknown } => !!v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object));
const plain = (c: ExcelJS.Cell): unknown => {
  const v = c.value as unknown;
  if (isF(v)) return undefined;
  if (v && typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
  if (v && typeof v === 'object' && 'hyperlink' in (v as object)) return `link:${(v as { text: string }).text}->${(v as { hyperlink: string }).hyperlink}`;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === '' ? null : v ?? null;
};
const formulaOf = (c: ExcelJS.Cell): string | null => (isF(c.value) ? (c.formula ?? null) : null);
const resultOf = (c: ExcelJS.Cell): unknown => { const v = c.value as unknown; return isF(v) ? v.result : v; };
const colL = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// The colour's six hex digits: Excel writes an opaque white as FFFFFFFF or 00FFFFFF, the same colour.
const argb = (x: unknown): string => String((x as { argb?: string } | undefined)?.argb ?? '').slice(-6).toUpperCase();
const fontKey = (c: ExcelJS.Cell): string => { const f = (c.font ?? {}) as Partial<ExcelJS.Font>; return [f.name ?? 'Calibri', f.size ?? 11, f.bold ? 'b' : '', f.italic ? 'i' : '', f.underline ? 'u' : '', argb(f.color)].join(','); };
const fillKey = (c: ExcelJS.Cell): string => { const f = c.fill as { type?: string; pattern?: string; fgColor?: unknown } | undefined; return f && f.type === 'pattern' && f.pattern === 'solid' ? argb(f.fgColor) : ''; };
const borderKey = (c: ExcelJS.Cell): string => { const b = (c.border ?? {}) as Partial<ExcelJS.Borders>; return (['top', 'bottom', 'left', 'right'] as const).map((k) => (b[k]?.style ? `${k[0]}:${b[k]!.style}:${argb(b[k]!.color)}` : '')).filter(Boolean).join(' '); };
const alignKey = (c: ExcelJS.Cell): string => { const a = (c.alignment ?? {}) as Partial<ExcelJS.Alignment>; return [a.horizontal ?? '', a.vertical ?? '', a.wrapText ? 'wrap' : '', a.indent ? `i${a.indent}` : ''].join(','); };
const numClose = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
/** A formula as Excel writes it: Excel upper-cases functions and drops a leading "=" and the _xlfn prefix. */
const normF = (f: string): string => f.replace(/^=/, '').replace(/_xlfn\./g, '').replace(/\s+/g, '');

interface Diff { at: string; cat: string; ref: string; ours: string }

function compareSheet(ref: ExcelJS.Worksheet, ours: ExcelJS.Worksheet, opts: { formulas: boolean; values?: ExcelJS.Worksheet }): Diff[] {
  const d: Diff[] = [];
  const add = (at: string, cat: string, a: unknown, b: unknown): void => { d.push({ at: `${ref.name}!${at}`, cat, ref: String(a ?? ''), ours: String(b ?? '') }); };
  const maxR = Math.max(ref.rowCount, ours.rowCount), maxC = Math.max(ref.columnCount, ours.columnCount);
  for (let c = 1; c <= maxC; c++) {
    const a = ref.getColumn(c).width ?? null, b = ours.getColumn(c).width ?? null;
    if (a !== b && !(a && b && Math.abs(a - b) < 0.01)) add(colL(c), 'width', a, b);
  }
  const fz = (ws: ExcelJS.Worksheet): string => { const v = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined; return v?.state === 'frozen' ? `${colL((v.xSplit ?? 0) + 1)}${(v.ySplit ?? 0) + 1}` : '-'; };
  if (fz(ref) !== fz(ours)) add('freeze', 'freeze', fz(ref), fz(ours));
  const merges = (ws: ExcelJS.Worksheet): string[] => Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges).sort();
  // The reference's merges, moved as its rows were moved (a merge keyed by its first cell).
  const sh0 = rowShift.get(ref.name) ?? ((r: number) => r);
  const ma = merges(ref).map((m) => m.replace(/^([A-Z]+)(\d+)$/, (_a, c: string, r: string) => `${c}${sh0(Number(r)) ?? r}`)), mb = merges(ours);
  for (const m of ma) if (!mb.includes(m)) add(m, 'merge', 'merged', '');
  for (const m of mb) if (!ma.includes(m)) add(m, 'merge', '', 'merged');
  const ps = (ws: ExcelJS.Worksheet): string => { const p = ws.pageSetup; return [p.orientation, p.paperSize, p.fitToPage ? 'fit' : '', p.fitToWidth, p.fitToHeight, p.printTitlesRow ?? ''].join(','); };
  if (ps(ref) !== ps(ours)) add('print', 'print', ps(ref), ps(ours));
  const cfs = (ws: ExcelJS.Worksheet): string[] => ((ws as unknown as { conditionalFormattings?: Array<{ ref: string; rules: Array<{ type: string; formulae?: string[] }> }> }).conditionalFormattings ?? [])
    .map((cf) => `${cf.ref} ${cf.rules.map((r) => `${r.type}:${(r.formulae ?? []).join(';')}`).join('|')}`).sort();
  const ca = cfs(ref), cb = cfs(ours);
  for (const x of ca) if (!cb.includes(x)) add('cf', 'cf', x, '');
  for (const x of cb) if (!ca.includes(x)) add('cf', 'cf', '', x);
  const shift = rowShift.get(ref.name) ?? ((r: number) => r);
  // The cells a merge covers (all but its first), on the reference.
  const slaves = new Set<string>();
  for (const m of Object.values((ref as unknown as { _merges: Record<string, { model?: { top: number; left: number; bottom: number; right: number } }> })._merges)) {
    const g = m.model; if (!g) continue;
    for (let r = g.top; r <= g.bottom; r++) for (let c = g.left; c <= g.right; c++) if (r !== g.top || c !== g.left) slaves.add(`${r}:${c}`);
  }
  const seen = new Set<number>();
  for (let r = 1; r <= maxR; r++) {
    const or = shift(r);
    if (or === null) continue;
    seen.add(or);
    const ha = ref.getRow(r).height ?? null, hb = ours.getRow(or).height ?? null;
    if ((ha ?? 15) !== (hb ?? 15) && !(ha && hb && Math.abs(ha - hb) < 0.01)) add(`row${r}`, 'height', ha, hb);
    for (let c = 1; c <= maxC; c++) {
      const A = ref.getCell(r, c), B = ours.getCell(or, c);
      const at = `${colL(c)}${r}${or !== r ? `(ours ${or})` : ''}`;
      const fa0 = formulaOf(A), fb = formulaOf(B);
      const fa = fa0 === null ? null : shiftRefFormula(fa0, ref.name);
      if (opts.formulas) {
        if ((fa ? normF(fa) : null) !== (fb ? normF(fb) : null)) add(at, 'formula', fa, fb);
        if (fa === null && fb === null) {
          const pa = plain(A), pb = plain(B);
          if (!(typeof pa === 'number' && typeof pb === 'number' ? numClose(pa, pb) : pa === pb)) add(at, 'value', pa, pb);
        } else if (fa && fb) {
          const ra = resultOf(A), rb = resultOf(B);
          // The reference was saved without recalculating some cells: a date cell holds the words it showed
          // ("Jan 2027"), which ExcelJS reads as an invalid date. There is no figure to compare.
          if (!(ra instanceof Date && Number.isNaN(ra.getTime()))) {
          // A formula the reference holds no figure for reads as 0 (its writer stored none for a zero).
          if (typeof ra === 'number' || typeof rb === 'number') { const x = typeof ra === 'number' ? ra : ra == null ? 0 : NaN, y = typeof rb === 'number' ? rb : rb == null ? 0 : NaN; if (!numClose(x, y)) add(at, 'result', ra, rb); }
          else if ((ra ?? '') !== (rb ?? '') && typeof ra !== 'object') add(at, 'result', ra, rb);
          }
        }
      } else {
        // The values file: a reference formula is a figure here; it must equal what the formula gives.
        const ra0 = fa ? resultOf(A) : plain(A), rb0 = plain(B) ?? (fb ? resultOf(B) : null);
        // A date read back as a date, or written as its Excel serial, is one value.
        const serial = (x: unknown): unknown => (x instanceof Date ? Math.round((x.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000) : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? Math.round((Date.parse(`${x}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000) : x);
        const ra = serial(ra0), rb = serial(rb0);
        // A cell a merge covers shows its first cell; the reference wrote nothing in it. The invalid date is a cell
        // the reference never recalculated (it holds the words it showed): no figure to compare.
        const covered = slaves.has(`${r}:${c}`) || (ra0 instanceof Date && Number.isNaN(ra0.getTime()));
        const zero = (x: unknown): boolean => x == null || x === '' || (typeof x === 'number' && Math.abs(x) < 1e-6);
        const same = zero(ra) && zero(rb) ? true : typeof ra === 'number' && typeof rb === 'number' ? numClose(ra, rb) : (ra ?? null) === (rb ?? null) || ((ra ?? 0) === 0 && (rb ?? 0) === 0 && typeof ra !== 'string');
        if (!same && !covered) add(at, 'value', ra, rb);
      }
      if (String(A.numFmt ?? 'General') !== String(B.numFmt ?? 'General') && (A.value !== null || B.value !== null)) add(at, 'numFmt', A.numFmt, B.numFmt);
      if (fontKey(A) !== fontKey(B) && (A.value !== null || B.value !== null)) add(at, 'font', fontKey(A), fontKey(B));
      if (fillKey(A) !== fillKey(B)) add(at, 'fill', fillKey(A), fillKey(B));
      if (borderKey(A) !== borderKey(B)) add(at, 'border', borderKey(A), borderKey(B));
      if (alignKey(A) !== alignKey(B) && (A.value !== null || B.value !== null)) add(at, 'alignment', alignKey(A), alignKey(B));
    }
  }
  // A row ours has that the reference has nowhere (besides the moves above) is a difference too.
  ours.eachRow({ includeEmpty: false }, (row, r) => {
    if (seen.has(r)) return;
    let any = false; row.eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== '') any = true; });
    if (any && !(ref.name === 'Inputs')) add(`row${r}`, 'extra', '', String(row.getCell(3).value ?? row.getCell(2).value ?? ''));
  });
  return d;
}

function report(label: string, diffs: Diff[]): void {
  const open = diffs.filter((x) => !accepted(x.at, x.cat));
  const byTab = new Map<string, Diff[]>();
  for (const x of open) { const t = x.at.split('!')[0]; byTab.set(t, [...(byTab.get(t) ?? []), x]); }
  const lines: string[] = [];
  for (const [t, xs] of byTab) {
    const cats = new Map<string, Diff[]>();
    for (const x of xs) cats.set(x.cat, [...(cats.get(x.cat) ?? []), x]);
    lines.push(`${t}: ${xs.length} (${[...cats].map(([c, v]) => `${c} ${v.length}`).join(', ')})`);
    for (const [, v] of cats) for (const x of (SHOW_ALL ? v : v.slice(0, 40))) lines.push(`    ${x.at} ${x.cat}: ref [${x.ref.slice(0, 90)}] ours [${x.ours.slice(0, 90)}]`);
  }
  check(`${label}: 0 differences from the reference (accepted by name: ${diffs.length - open.length})`, open.length === 0, `${open.length} differences\n${lines.join('\n')}`);
}

(async () => {
  console.log('=== verify-export-vs-reference ===');
  if (!existsSync(REF_PATH)) {
    console.log(`  SKIP: ${REF_PATH} is not present (it is local and gitignored, so CI has none). Nothing compared.`);
    console.log('\n=== Result: 0 passed, 0 failed ===');
    return;
  }
  const refBuf = readFileSync(REF_PATH);
  const ref = await loadWithoutDrawings(refBuf);

  let liveBuf: Buffer | ArrayBuffer, valuesBuf: Buffer | ArrayBuffer;
  const fileLive = arg('--file'), fileValues = arg('--values');
  if (fileLive) { liveBuf = readFileSync(fileLive); valuesBuf = fileValues ? readFileSync(fileValues) : liveBuf; }
  else {
    const { loadLiveExportInputs } = await import('./fixtures/liveExportInputs');
    const { generateLiveWorkbook } = await import('../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook');
    const { generateValuesWorkbookBuffer } = await import('../src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook');
    const live = await loadLiveExportInputs();
    const common = { state: live.state, projectName: live.projectName, dateLabel: 'reference', displayScale: 'millions' as const,
      caseComparison: live.caseComparison ?? undefined, parties: live.parties as never, includeSensitivity: true };
    const built = await generateLiveWorkbook(common);
    if (!built.ok) { check('the live workbook builds for the reference project', false, `${built.message} ${built.detail}`); process.exit(1); }
    liveBuf = built.buffer;
    valuesBuf = await generateValuesWorkbookBuffer(common);
  }
  const ours = await loadWithoutDrawings(liveBuf);
  const vals = fileLive && !fileValues ? null : await loadWithoutDrawings(valuesBuf);
  setRowShifts(ref, ours);

  console.log('\n--- A. the live export against the reference ---');
  const order = (wb: ExcelJS.Workbook): string => wb.worksheets.map((w) => w.name).join(', ');
  check('A1 the tabs, in order', order(ref) === order(ours), `ref:  ${order(ref)}\nours: ${order(ours)}`);
  const [rc, oc] = [await chartsOf(refBuf), await chartsOf(liveBuf)];
  check('A2 the charts (type and series ranges)', rc.join('\n') === oc.join('\n'), `ref:\n${rc.join('\n')}\nours:\n${oc.join('\n')}`);
  const diffs: Diff[] = [];
  for (const ws of ref.worksheets) {
    if (ONLY_TAB && ws.name !== ONLY_TAB) continue;
    const o = ours.getWorksheet(ws.name);
    if (!o) { diffs.push({ at: `${ws.name}!*`, cat: 'missing tab', ref: ws.name, ours: '' }); continue; }
    diffs.push(...compareSheet(ws, o, { formulas: true }));
  }
  report('A3 the live export, cell for cell', diffs);

  if (vals) {
    console.log('\n--- B. the values export: the same structure, figures not formulas ---');
    check('B1 the tabs, in order', order(ref) === order(vals), `ref:  ${order(ref)}\nours: ${order(vals)}`);
    const vc = await chartsOf(valuesBuf);
    check('B2 the charts (type and series ranges)', rc.join('\n') === vc.join('\n'), `ref:\n${rc.join('\n')}\nours:\n${vc.join('\n')}`);
    mode = 'values';
    const vd: Diff[] = [];
    for (const ws of ref.worksheets) {
      if (ONLY_TAB && ws.name !== ONLY_TAB) continue;
      const o = vals.getWorksheet(ws.name);
      if (!o) { vd.push({ at: `${ws.name}!*`, cat: 'missing tab', ref: ws.name, ours: '' }); continue; }
      vd.push(...compareSheet(ws, o, { formulas: false }));
    }
    mode = 'values';
    report('B3 the values export, cell for cell', vd);
    // B4 THE VALUES FILE HOLDS WHAT EACH FORMULA HOLDS (2026-11-17, founder: 3,518 zeros were written as blank): every
    // formula cell of the live file against its values cell, a missing cached result being the 0 it stands for
    // (ExcelJS reads a cached 0 as no result), 0 = 0, and blank only where the formula returns "".
    {
      const bad: string[] = []; let cells = 0, zeros = 0;
      for (const ws of ours.worksheets) {
        const vw = vals.getWorksheet(ws.name);
        if (!vw) { bad.push(`${ws.name} missing`); continue; }
        ws.eachRow((row, r) => row.eachCell((c, col) => {
          const v = c.value as { formula?: string; result?: unknown } | null;
          if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
          if (c.isMerged && c.master.address !== c.address) return;
          // A cell whose values-file words the founder asked to differ (the Guide's purpose line) is named above.
          if (accepted(`${ws.name}!${c.address}`, 'value')) return;
          cells++;
          const res = v.result;
          const want = res === undefined || res === null ? 0 : res === '' ? null : res instanceof Date ? res.getTime() : res;
          const g0 = vw.getCell(r, col).value as unknown;
          const got = g0 instanceof Date ? g0.getTime() : g0 === '' ? null : g0 ?? null;
          if (want === 0) zeros++;
          const same = typeof want === 'number' && typeof got === 'number' ? Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want)) : want === got;
          if (!same && bad.length < 400) bad.push(`${ws.name}!${c.address} live ${JSON.stringify(want)} values ${JSON.stringify(got)}`);
        }));
      }
      check(`B4 every formula's value is in the values file, 0 as 0 and blank only for "" (${cells} formula cells, ${zeros} zeros)`, bad.length === 0 && cells > 5000 && zeros > 0, `${bad.length} differ: ${bad.slice(0, 12).join('; ')}`);
    }
  }

  // D. THE LOOP FROM A COLD START (founder, open fix 8): the live file with every stored value taken out, recalculated
  // from nothing in real Excel, must come back to the same figures (and no error anywhere), or the financing loop
  // depends on the values it was saved with.
  if (!argv.includes('--no-excel')) {
    console.log('\n--- D. Real Excel, a cold start: every stored value taken out ---');
    const { excelAvailable, recalcInExcel } = await import('./excelRecalc');
    const ok = excelAvailable();
    if (!ok.ok) console.log(`  SKIP D: ${ok.reason}`);
    else {
      // THE PROCEDURE THE GUIDE GIVES (section 3): a file opened with no stored values starts its loop from empty
      // cells, which Excel reads as text, and keeps the #VALUE! it makes for ever (TRAPS 3.46). The circularity switch
      // at 0 cuts every loop, so the file opens to figures; set back to 1, the loop iterates from them. The cold copy
      // is saved with the switch at 0, and Excel sets it to 1 and recalculates.
      const inputs = ours.getWorksheet('Inputs');
      let swAt = '';
      inputs?.eachRow((row, r) => row.eachCell((c, col) => { if (c.value === 'Circularity switch (1 = on)') swAt = `${colL(col + 1)}${r}`; }));
      check('D0 Inputs carries the circularity switch, at 1', !!swAt && inputs?.getCell(swAt).value === 1, swAt || '(none)');
      const z = await JSZip.loadAsync(liveBuf);
      const wbXml0 = await z.file('xl/workbook.xml')!.async('string');
      const relsXml = await z.file('xl/_rels/workbook.xml.rels')!.async('string');
      const rid = /<sheet [^>]*name="Inputs"[^>]*r:id="([^"]+)"/.exec(wbXml0)?.[1];
      const inputsPart = rid ? `xl/${(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(relsXml) ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(relsXml))?.[1].replace(/^\/?xl\//, '')}` : '';
      for (const n of Object.keys(z.files)) {
        if (z.files[n].dir || !/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) continue;
        let s = await z.file(n)!.async('string');
        // A formula cell keeps its formula and loses its value (and the type that came with it).
        s = s.replace(/<c ([^>]*?)>(<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>)<v>[\s\S]*?<\/v><\/c>/g, (_all, attrs: string, f: string) => `<c ${attrs.replace(/\s+t="[^"]*"/, '')}>${f}</c>`);
        if (n === inputsPart && swAt) s = s.replace(new RegExp(`(<c r="${swAt}"[^>]*>)<v>1</v>`), '$1<v>0</v>');
        z.file(n, s);
      }
      if (z.file('xl/calcChain.xml')) z.remove('xl/calcChain.xml');
      const wbx = await z.file('xl/workbook.xml')!.async('string');
      z.file('xl/workbook.xml', /<calcPr /.test(wbx) && !/fullCalcOnLoad=/.test(wbx) ? wbx.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ') : wbx);
      const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'fmp-cold-'));
      const p = join(dir, 'cold.xlsx');
      writeFileSync(p, await z.generateAsync({ type: 'nodebuffer' }));
      try {
        const rec = recalcInExcel(p, swAt ? [{ ref: `Inputs!${swAt}`, value: 1 }] : []);
        const errs = [...rec.cells].filter(([, v]) => typeof v === 'object').map(([k]) => k);
        check('D1 no cell recalculates to an Excel error from a cold start (switch 0, then 1)', errs.length === 0, `${errs.length} errors: ${errs.slice(0, 8).join(', ')}`);
        // Every figure against the value the platform stored (the warm file).
        let worst = { at: '', gap: 0 }, compared = 0;
        for (const ws of ours.worksheets) ws.eachRow((row, r) => row.eachCell((c, col) => {
          const v = c.value as { formula?: string; result?: unknown } | null;
          if (!v || typeof v !== 'object' || typeof v.formula !== 'string' || typeof v.result !== 'number') return;
          const x = rec.cells.get(`${ws.name}!R${r}C${col}`);
          if (typeof x !== 'number') return;
          compared++;
          const gap = Math.abs(x - v.result) / Math.max(1, Math.abs(v.result));
          if (gap > worst.gap) worst = { at: `${ws.name}!${c.address}`, gap };
        }));
        check(`D2 every figure converges to the stored value (${compared} compared; largest gap ${worst.gap.toExponential(2)}${worst.at ? ` at ${worst.at}` : ''})`, compared > 1000 && worst.gap < 1e-6);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  }

  if (!ONLY_TAB) {
    const stale = ACCEPTED.filter((a, i) => !used.has(i) && !a.mayNotOccur).map((a) => a.why);
    check('C1 every accepted difference still occurs (none stale)', stale.length === 0, stale.join('\n'));
  }
  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exitCode = 1;
})();
