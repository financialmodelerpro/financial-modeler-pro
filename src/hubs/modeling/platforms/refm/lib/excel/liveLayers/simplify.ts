/**
 * simplify.ts (2026-10-11), SIMPLE FORMULAS, ONE PASS OVER THE WHOLE WORKBOOK.
 *
 * The founder's rule for the formula-linked export: a reader should be able to
 * follow every formula. The layers build formulas term by term (a line's capex is
 * the sum of its plots, a total the sum of its lines), which is right for the
 * arithmetic and wrong for the reader: a total of thirty rows printed as thirty
 * references joined by "+", 1,765 characters long.
 *
 * This pass rewrites the TEXT of a formula and never its arithmetic:
 *   1. a chain of three or more plain references added together becomes one SUM,
 *      with neighbouring cells merged into ranges ('Capex Calc'!$X$10:$X$20);
 *      `N(ref)` joins such a chain, since SUM reads text and blanks as 0 exactly
 *      as N does;
 *   2. terms that add nothing are dropped: "+0", "-0", "+(0)", "-(0)".
 * Both are exact: a sum is the same numbers added, so a cell recalculates to the
 * same value (the proof is verify-formula-workbook in real Excel). Text inside
 * quotes is never touched, and a chain is cut where an operator binds tighter
 * than "+" (a term multiplied, divided or negated stays where it is).
 *
 * The cells a formula reads do not change, so the build's pending bookkeeping
 * (writer.ts) and the shaded-input audit (inputAudit.ts) are unaffected.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

const SHEET = `(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)`;
const REF = `${SHEET}!\\$[A-Z]{1,3}\\$\\d+`;
const TERM = `(?:N\\(${REF}\\)|${REF})`;
const RUN = new RegExp(`${TERM}(?:\\+${TERM})+`, 'g');
const TERM_RE = new RegExp(TERM, 'g');
const PARTS = /^(?:N\()?((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*))!\$([A-Z]{1,3})\$(\d+)\)?$/;

/** A chain may START after one of these (or at the start). */
const OPEN_OK = new Set(['', '(', ',', '+', '=', '<', '>', '&']);
/** A chain may END before one of these (or at the end). */
const CLOSE_OK = new Set(['', ')', ',', '+', '-', '=', '<', '>', '&']);

const colNum = (s: string): number => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLet = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** One chain of terms as SUM(...), neighbours merged into ranges. */
function asSum(terms: string[]): string {
  const cells = terms.map((t) => { const m = PARTS.exec(t)!; return { sheet: m[1], col: colNum(m[2]), row: Number(m[3]) }; });
  // Group by sheet and column; within a column, consecutive rows form a range.
  const byCol = new Map<string, number[]>();
  const order: string[] = [];
  for (const c of cells) {
    const k = `${c.sheet}\u0000${c.col}`;
    if (!byCol.has(k)) { byCol.set(k, []); order.push(k); }
    byCol.get(k)!.push(c.row);
  }
  const items: string[] = [];
  for (const k of order) {
    const [sheet, colS] = k.split('\u0000');
    const col = colLet(Number(colS));
    const rows = [...byCol.get(k)!].sort((a, b) => a - b);
    for (let i = 0; i < rows.length;) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      items.push(i === j ? `${sheet}!$${col}$${rows[i]}` : `${sheet}!$${col}$${rows[i]}:$${col}$${rows[j]}`);
      i = j + 1;
    }
  }
  // A single column of rows can also be a single row of columns: merge same-row singles.
  return `SUM(${mergeRows(items).join(',')})`;
}

/** Singles on one sheet and row in consecutive columns become a horizontal range, in place. */
function mergeRows(items: string[]): string[] {
  const single = /^(.+)!\$([A-Z]{1,3})\$(\d+)$/;
  const slots: Array<string | { key: string }> = [];
  const pool = new Map<string, number[]>();
  for (const it of items) {
    const m = single.exec(it);
    if (!m) { slots.push(it); continue; }
    const k = `${m[1]}\u0000${m[3]}`;
    if (!pool.has(k)) { pool.set(k, []); slots.push({ key: k }); }
    pool.get(k)!.push(colNum(m[2]));
  }
  return slots.flatMap((x) => {
    if (typeof x === 'string') return [x];
    const [sheet, row] = x.key.split('\u0000');
    const cols = [...new Set(pool.get(x.key)!)].sort((a, b) => a - b);
    const out: string[] = [];
    for (let i = 0; i < cols.length;) {
      let j = i;
      while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
      out.push(i === j ? `${sheet}!$${colLet(cols[i])}$${row}` : `${sheet}!$${colLet(cols[i])}$${row}:$${colLet(cols[j])}$${row}`);
      i = j + 1;
    }
    return out;
  });
}

function sumChains(code: string): string {
  return code.replace(RUN, (run, offset: number) => {
    const terms = run.match(TERM_RE)!;
    let lead = '', trail = '';
    const prev = offset > 0 ? code[offset - 1] : '';
    const next = code[offset + run.length] ?? '';
    // A term bound to its left neighbour by * / ^ or a minus is not part of the chain.
    if (!OPEN_OK.has(prev)) lead = `${terms.shift()}+`;
    if (!CLOSE_OK.has(next) && terms.length) trail = `+${terms.pop()}`;
    if (terms.length < 3) return run;
    return `${lead}${asSum(terms)}${trail}`;
  });
}

/** A SUM a layer wrote as a list of single cells: neighbours merged into ranges. */
const RANGE = `${SHEET}!\\$[A-Z]{1,3}\\$\\d+:\\$[A-Z]{1,3}\\$\\d+`;
const SUM_LIST = new RegExp(`SUM\\(((?:${RANGE}|${REF})(?:,(?:${RANGE}|${REF}))+)\\)`, 'g');
const ARG = new RegExp(`${RANGE}|${REF}`, 'g');
function mergeSumLists(code: string): string {
  return code.replace(SUM_LIST, (whole, list: string) => {
    const args = list.match(ARG)!;
    if (args.join(',') !== list) return whole;
    const singles = args.filter((a) => !a.includes(':')), ranges = args.filter((a) => a.includes(':'));
    if (singles.length < 2) return whole;
    const merged = asSum(singles).slice(4, -1);
    return `SUM(${[merged, ...ranges].join(',')})`;
  });
}

/**
 * "MAX(0,a)+MAX(0,b)+..." over one contiguous run of cells (a row of years, say) is
 * the sum of the positive values: SUMIF(range,">0"). Exact: MAX(0,x) adds x when it
 * is positive and nothing otherwise, and SUMIF, like N, reads a blank or text as nothing.
 */
const POS = `MAX\\(0,(?:N\\(${REF}\\)|${REF})\\)`;
const POS_RUN = new RegExp(`${POS}(?:\\+${POS})+`, 'g');
const POS_RE = new RegExp(POS, 'g');
function positiveSums(code: string): string {
  return code.replace(POS_RUN, (run, offset: number) => {
    const prev = offset > 0 ? code[offset - 1] : '';
    const next = code[offset + run.length] ?? '';
    if (!OPEN_OK.has(prev) || !CLOSE_OK.has(next)) return run;
    const terms = run.match(POS_RE)!;
    const cells = terms.map((t) => PARTS.exec(t.slice(6, -1)));
    if (cells.some((m) => !m)) return run;
    const cs = cells.map((m) => ({ sheet: m![1], col: colNum(m![2]), row: Number(m![3]) }));
    // Consecutive terms that step one column along a row (or one row down a column) form a group.
    const out: string[] = [];
    for (let i = 0; i < cs.length;) {
      let j = i;
      const along = (a: typeof cs[0], b: typeof cs[0]): boolean => a.sheet === b.sheet
        && ((a.row === b.row && b.col === a.col + 1) || (a.col === b.col && b.row === a.row + 1));
      while (j + 1 < cs.length && along(cs[j], cs[j + 1]) && (j === i || (cs[j + 1].row === cs[i].row) === (cs[j].row === cs[i].row))) j++;
      if (j - i + 1 >= 3) out.push(`SUMIF(${cs[i].sheet}!$${colLet(cs[i].col)}$${cs[i].row}:$${colLet(cs[j].col)}$${cs[j].row},">0")`);
      else for (let k = i; k <= j; k++) out.push(terms[k]);
      i = j + 1;
    }
    return out.join('+');
  });
}

/**
 * "SUM(a)+SUM(b)+..." is one SUM over every argument, and ranges that stack (the
 * same columns on consecutive rows, or the same rows in consecutive columns) are one
 * block: SUM('Capex Calc'!$X$34:$AI$44).
 */
const SUM_TERM = `SUM\\((?:${RANGE}|${REF})(?:,(?:${RANGE}|${REF}))*\\)`;
const SUM_RUN = new RegExp(`${SUM_TERM}(?:\\+${SUM_TERM})+`, 'g');
const SUM_TERM_RE = new RegExp(SUM_TERM, 'g');
function sumOfSums(code: string): string {
  return code.replace(SUM_RUN, (run, offset: number) => {
    const prev = offset > 0 ? code[offset - 1] : '';
    const next = code[offset + run.length] ?? '';
    if (!OPEN_OK.has(prev) || !CLOSE_OK.has(next)) return run;
    const args = run.match(SUM_TERM_RE)!.flatMap((t) => t.slice(4, -1).match(ARG)!);
    return `SUM(${mergeRanges(args).join(',')})`;
  });
}

/** Ranges with the same span that stack edge to edge become one block; anything else is kept. */
function mergeRanges(args: string[]): string[] {
  const R = /^(.+)!\$([A-Z]{1,3})\$(\d+):\$([A-Z]{1,3})\$(\d+)$/;
  type B = { sheet: string; c0: number; r0: number; c1: number; r1: number };
  const blocks: Array<B | string> = args.map((a) => {
    const m = R.exec(a);
    return m ? { sheet: m[1], c0: colNum(m[2]), r0: Number(m[3]), c1: colNum(m[4]), r1: Number(m[5]) } : a;
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < blocks.length && !changed; i++) for (let j = 0; j < blocks.length && !changed; j++) {
      const a = blocks[i], b = blocks[j];
      if (i === j || typeof a === 'string' || typeof b === 'string' || a.sheet !== b.sheet) continue;
      if (a.c0 === b.c0 && a.c1 === b.c1 && b.r0 === a.r1 + 1) { blocks[i] = { ...a, r1: b.r1 }; blocks.splice(j, 1); changed = true; }
      else if (a.r0 === b.r0 && a.r1 === b.r1 && b.c0 === a.c1 + 1) { blocks[i] = { ...a, c1: b.c1 }; blocks.splice(j, 1); changed = true; }
    }
  }
  return blocks.map((b) => (typeof b === 'string' ? b : `${b.sheet}!$${colLet(b.c0)}$${b.r0}:$${colLet(b.c1)}$${b.r1}`));
}

/** Drop "+0", "-0", "+(0)", "-(0)" where they follow an operand and precede a low-precedence boundary. */
function dropZeros(code: string): string {
  const re = /([)\w$])([+-])(?:0|\(0\))(?=$|[)+\-,=<>&])/g;
  let prev: string;
  do { prev = code; code = code.replace(re, '$1'); } while (code !== prev);
  return code;
}

/** "(SUM(...))" or "(ref)" standing alone in brackets loses them, both being atomic
 *  (a function call's own bracket, preceded by its name, stays). */
const ATOM_IN_BRACKETS = new RegExp(`(^|[^A-Za-z0-9_.])\\((SUM\\([^()"]*\\)|SUMIF\\([^()"]*,">0"\\)|${REF})\\)`, 'g');
function dropSumBrackets(code: string): string {
  let prev: string;
  do { prev = code; code = code.replace(ATOM_IN_BRACKETS, '$1$2'); } while (code !== prev);
  return code;
}

const pass = (code: string, chains: boolean): string => dropSumBrackets(dropZeros(sumOfSums(mergeSumLists((chains ? sumChains : (c: string) => c)(positiveSums(code))))));

/** Rewrite one formula (without the leading "="). Text in quotes is left alone. */
export function simplifyFormula(f: string, opts: { sumChains?: boolean } = {}): string {
  const chains = opts.sumChains !== false;
  if (f.indexOf('"') < 0) return pass(f, chains);
  // Split on quotes: even pieces are code, odd pieces are text literals.
  const parts = f.split('"');
  // A chain never spans a literal, so each code piece is simplified on its own.
  return parts.map((p, i) => (i % 2 === 0 ? pass(p, chains) : p)).join('"');
}

/**
 * THE CIRCULAR SOLVE KEEPS ITS "+" CHAINS (measured 2026-10-11). On the financing
 * working sheet, where Excel iterates the circle, one row rewritten from
 * a+b+c to SUM(a,b,c) left the whole loop at #VALUE! in real Excel (the iteration
 * never started), on single cells as much as on ranges; every other rewrite there
 * recalculates exactly. So sum chains are left alone on that one sheet.
 */
export const CIRCULAR_SHEETS = new Set(['Financing Calc']);

/** Apply `simplifyFormula` to every formula cell of the workbook. Returns how many changed. */
export function simplifyWorkbook(wb: ExcelJS.Workbook): number {
  let changed = 0;
  for (const ws of wb.worksheets) {
    const sumChainsHere = !CIRCULAR_SHEETS.has(ws.name);
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value as unknown as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const s = simplifyFormula(v.formula, { sumChains: sumChainsHere });
      if (s !== v.formula) { cell.value = { formula: s, result: v.result } as unknown as ExcelJS.CellValue; changed++; }
    }));
  }
  return changed;
}
