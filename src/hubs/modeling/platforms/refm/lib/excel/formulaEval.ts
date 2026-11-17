/**
 * formulaEval.ts (2026-11-17, founder: the Dashboard, the Guide and the Cover of both workbooks)
 *
 * A SMALL EXCEL FORMULA EVALUATOR FOR THE FRONT TABS. Their cells are formulas over figures the workbook already
 * holds (each with the cached value the builder printed), so the value each formula shows when the file opens is
 * worked out here from those cached values, the way Excel would: the values file (the live file frozen) and a
 * reader whose Excel has not recalculated yet both see the right figure.
 *
 * It covers what those tabs use and nothing more: numbers, text, references and ranges (on any tab), the
 * operators + - * / ^ & = <> < > <= >=, and SUM, SUMIF, SUMIFS, COUNTIF, MAX, MIN, IF, IFERROR, AND, OR, NOT,
 * TEXT, INDEX, MATCH, ABS, ROUND, YEAR, N, CONCATENATE. Anything else throws, so a new function is added here
 * on purpose. Errors are values (#DIV/0!, #N/A, #VALUE!) and flow as Excel's do.
 *
 * No em dashes in this file.
 */

export type Scalar = number | string | boolean | null | XlError;
export class XlError { constructor(readonly code: string) {} toString(): string { return this.code; } }
type Range = { sheet: string; r1: number; c1: number; r2: number; c2: number };
type Val = Scalar | Range;

/** Reads a cell's value (a figure, a text, or null for an empty cell). */
export type CellReader = (sheet: string, r: number, c: number) => Scalar;

const colNum = (s: string): number => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const isRange = (v: Val): v is Range => !!v && typeof v === 'object' && 'r1' in v;
const isErr = (v: unknown): v is XlError => v instanceof XlError;

interface Tok { t: 'num' | 'str' | 'ref' | 'fn' | 'op' | '(' | ')' | ',' ; v: string }

function tokenize(f: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = f.replace(/^=/, '');
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '"') { let j = i + 1, txt = ''; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { txt += '"'; j += 2; continue; } break; } txt += s[j++]; } out.push({ t: 'str', v: txt }); i = j + 1; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i))!; out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (ch === '(' || ch === ')' || ch === ',') { out.push({ t: ch, v: ch }); i++; continue; }
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    // A reference (optionally on a tab, optionally a range), or a function name.
    const ref = /^((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/.exec(s.slice(i));
    if (ref && !/^[A-Za-z_][A-Za-z0-9_.]*\(/.test(s.slice(i))) { out.push({ t: 'ref', v: ref[0] }); i += ref[0].length; continue; }
    const fn = /^[A-Za-z_][A-Za-z0-9_.]*(?=\()/.exec(s.slice(i));
    if (fn) { out.push({ t: 'fn', v: fn[0].toUpperCase().replace(/^_XLFN\./, '') }); i += fn[0].length; continue; }
    const name = /^(TRUE|FALSE)\b/i.exec(s.slice(i));
    if (name) { out.push({ t: 'num', v: name[1].toUpperCase() === 'TRUE' ? '1' : '0' }); i += name[0].length; continue; }
    throw new Error(`formulaEval: cannot read "${s.slice(i, i + 20)}" in ${f}`);
  }
  return out;
}

function parseRef(text: string, own: string): Range {
  const m = /^(?:((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(text)!;
  const sheet = m[1] ? (m[1].startsWith("'") ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]) : own;
  const c1 = colNum(m[2]), r1 = Number(m[3]);
  const c2 = m[4] ? colNum(m[4]) : c1, r2 = m[5] ? Number(m[5]) : r1;
  return { sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Excel's TEXT for the formats the front tabs use. */
export function textOf(v: Scalar, fmt: string): string {
  if (isErr(v)) return v.code;
  if (typeof v === 'string') { const n = Number(v); if (v.trim() === '' || Number.isNaN(n)) return v; v = n; }
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
  if (/[ymd]/i.test(fmt) && !/0/.test(fmt)) {
    const d = new Date(EXCEL_EPOCH + Math.round(n) * 86_400_000);
    return fmt.replace(/yyyy|yy|mmmm|mmm|mm|dd|d/gi, (k) => {
      const kk = k.toLowerCase();
      if (kk === 'yyyy') return String(d.getUTCFullYear());
      if (kk === 'yy') return String(d.getUTCFullYear()).slice(-2);
      if (kk === 'mmm') return MONTHS[d.getUTCMonth()];
      if (kk === 'mm') return String(d.getUTCMonth() + 1).padStart(2, '0');
      if (kk === 'dd') return String(d.getUTCDate()).padStart(2, '0');
      if (kk === 'd') return String(d.getUTCDate());
      return k;
    });
  }
  const pct = fmt.includes('%');
  const core = fmt.replace(/[^0#,.]/g, '');
  const dec = core.includes('.') ? core.split('.')[1].replace(/[^0#]/g, '').length : 0;
  const x = pct ? n * 100 : n;
  // Excel rounds half away from zero.
  const f = 10 ** dec;
  const r = Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f;
  let s = Math.abs(r).toFixed(dec);
  if (core.includes(',')) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b !== undefined ? `.${b}` : ''); }
  const lit = fmt.replace(/^[0#,.%]+/, '').replace(/%/, '');
  return `${r < 0 ? '-' : ''}${s}${pct ? '%' : ''}${lit.replace(/"/g, '')}`;
}

export class FormulaEvaluator {
  constructor(private readonly read: CellReader) {}

  evaluate(formula: string, own: string): Scalar {
    const toks = tokenize(formula);
    let p = 0;
    const peek = (): Tok | undefined => toks[p];
    const next = (): Tok => toks[p++];
    const expect = (t: Tok['t']): void => { const k = next(); if (!k || k.t !== t) throw new Error(`formulaEval: expected ${t} in ${formula}`); };

    const cellScalar = (rg: Range): Scalar => this.read(rg.sheet, rg.r1, rg.c1);
    const scalar = (v: Val): Scalar => (isRange(v) ? cellScalar(v) : v);
    const num = (v: Val): number | XlError => {
      const s = scalar(v);
      if (isErr(s)) return s;
      if (s === null || s === '') return 0;
      if (typeof s === 'boolean') return s ? 1 : 0;
      if (typeof s === 'number') return s;
      const n = Number(s);
      return Number.isNaN(n) ? new XlError('#VALUE!') : n;
    };
    const str = (v: Val): string | XlError => {
      const s = scalar(v);
      if (isErr(s)) return s;
      if (s === null) return '';
      if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE';
      if (typeof s === 'number') return String(Math.round(s * 1e10) / 1e10);
      return s;
    };
    const cells = (v: Val): Scalar[] => {
      if (!isRange(v)) return [v];
      const out: Scalar[] = [];
      for (let r = v.r1; r <= v.r2; r++) for (let c = v.c1; c <= v.c2; c++) out.push(this.read(v.sheet, r, c));
      return out;
    };
    const crit = (c: Scalar): ((x: Scalar) => boolean) => {
      const s = typeof c === 'string' ? c : String(c ?? '');
      const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!;
      const op = m[1] ?? '=', rhs = m[2];
      const rn = Number(rhs), isNum = rhs.trim() !== '' && !Number.isNaN(rn);
      const wild = !isNum && /[*?]/.test(rhs) ? new RegExp(`^${rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null;
      return (x) => {
        if (isNum) {
          const xn = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)) ? Number(x) : null;
          if (xn === null) return op === '<>';
          switch (op) { case '<': return xn < rn; case '>': return xn > rn; case '<=': return xn <= rn; case '>=': return xn >= rn; case '<>': return xn !== rn; default: return xn === rn; }
        }
        const xs = x === null ? '' : String(x);
        const eq = wild ? wild.test(xs) : xs.toLowerCase() === rhs.toLowerCase();
        return op === '<>' ? !eq : eq;
      };
    };
    const firstErr = (xs: unknown[]): XlError | null => { for (const x of xs) if (isErr(x)) return x; return null; };

    const call = (name: string, args: Val[]): Val => {
      switch (name) {
        case 'SUM': { let s = 0; for (const a of args) for (const x of cells(a)) { if (isErr(x)) return x; if (typeof x === 'number') s += x; } return s; }
        case 'MAX': case 'MIN': {
          const xs: number[] = [];
          for (const a of args) for (const x of cells(a)) { if (isErr(x)) return x; if (typeof x === 'number') xs.push(x); }
          return xs.length ? (name === 'MAX' ? Math.max(...xs) : Math.min(...xs)) : 0;
        }
        case 'SUMIF': {
          const [rg, c, sr] = args; const test = crit(scalar(c));
          const a = cells(rg), b = sr ? cells(sr) : a; let s = 0;
          a.forEach((x, i) => { if (test(x) && typeof b[i] === 'number') s += b[i] as number; });
          return s;
        }
        case 'SUMIFS': {
          const sum = cells(args[0]); let s = 0;
          const pairs: Array<[Scalar[], (x: Scalar) => boolean]> = [];
          for (let k = 1; k < args.length; k += 2) pairs.push([cells(args[k]), crit(scalar(args[k + 1]))]);
          sum.forEach((x, i) => { if (typeof x === 'number' && pairs.every(([rg, t]) => t(rg[i]))) s += x; });
          return s;
        }
        case 'COUNTIF': { const t = crit(scalar(args[1])); return cells(args[0]).filter((x) => t(x)).length; }
        case 'IF': {
          const c = num(args[0]); if (isErr(c)) return c;
          return c !== 0 ? (args[1] === undefined ? true : args[1]) : (args[2] === undefined ? false : args[2]);
        }
        case 'IFERROR': { const v = scalar(args[0]); return isErr(v) ? args[1] : args[0]; }
        case 'AND': { for (const a of args) { const n = num(a); if (isErr(n)) return n; if (n === 0) return false; } return true; }
        case 'OR': { for (const a of args) { const n = num(a); if (isErr(n)) return n; if (n !== 0) return true; } return false; }
        case 'NOT': { const n = num(args[0]); return isErr(n) ? n : n === 0; }
        case 'TEXT': { const v = scalar(args[0]); const f = str(args[1]); if (isErr(f)) return f; return isErr(v) ? v : textOf(v, f); }
        case 'INDEX': {
          const rg = args[0]; if (!isRange(rg)) return args[0];
          const a = num(args[1]); if (isErr(a)) return a;
          const b = args[2] === undefined ? 1 : num(args[2]); if (isErr(b)) return b;
          const oneRow = rg.r1 === rg.r2;
          const r = oneRow ? rg.r1 : rg.r1 + a - 1, c = oneRow ? rg.c1 + a - 1 : rg.c1 + b - 1;
          if (r > rg.r2 || c > rg.c2 || r < rg.r1 || c < rg.c1) return new XlError('#REF!');
          return this.read(rg.sheet, r, c);
        }
        case 'MATCH': {
          const want = scalar(args[0]); const xs = cells(args[1]);
          const i = xs.findIndex((x) => (typeof want === 'number' && typeof x === 'number' ? Math.abs(x - want) < 1e-9 : String(x ?? '').toLowerCase() === String(want ?? '').toLowerCase()));
          return i < 0 ? new XlError('#N/A') : i + 1;
        }
        case 'ABS': { const n = num(args[0]); return isErr(n) ? n : Math.abs(n); }
        case 'ROUND': { const n = num(args[0]); const d = num(args[1]); if (isErr(n)) return n; if (isErr(d)) return d; const f = 10 ** d; return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f; }
        case 'YEAR': { const n = num(args[0]); return isErr(n) ? n : new Date(EXCEL_EPOCH + Math.round(n) * 86_400_000).getUTCFullYear(); }
        case 'N': { const s = scalar(args[0]); return typeof s === 'number' ? s : 0; }
        case 'CONCATENATE': { let s = ''; for (const a of args) { const t = str(a); if (isErr(t)) return t; s += t; } return s; }
        default: throw new Error(`formulaEval: ${name} is not supported (add it here on purpose)`);
      }
    };

    const primary = (): Val => {
      const k = next();
      if (!k) throw new Error(`formulaEval: unexpected end of ${formula}`);
      if (k.t === 'num') return Number(k.v);
      if (k.t === 'str') return k.v;
      if (k.t === 'ref') return parseRef(k.v, own);
      if (k.t === '(') { const v = expr(0); expect(')'); return v; }
      if (k.t === 'op' && k.v === '-') { const v = num(unary()); return isErr(v) ? v : -v; }
      if (k.t === 'op' && k.v === '+') return unary();
      if (k.t === 'fn') {
        expect('(');
        const args: Val[] = [];
        if (peek()?.t !== ')') { args.push(expr(0)); while (peek()?.t === ',') { next(); args.push(expr(0)); } }
        expect(')');
        return call(k.v, args);
      }
      throw new Error(`formulaEval: unexpected ${k.v} in ${formula}`);
    };
    const unary = (): Val => { const v = primary(); if (peek()?.t === 'op' && peek()!.v === '%') { next(); const n = num(v); return isErr(n) ? n : n / 100; } return v; };
    const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
    const expr = (min: number): Val => {
      let left = unary();
      for (;;) {
        const k = peek();
        if (!k || k.t !== 'op' || PREC[k.v] === undefined || PREC[k.v] < min) return left;
        next();
        const right = expr(PREC[k.v] + (k.v === '^' ? 0 : 1));
        left = binary(k.v, left, right);
      }
    };
    const binary = (op: string, a: Val, b: Val): Val => {
      if (op === '&') { const x = str(a), y = str(b); return isErr(x) ? x : isErr(y) ? y : x + y; }
      if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
        const x = scalar(a), y = scalar(b);
        const e = firstErr([x, y]); if (e) return e;
        const cmp = typeof x === 'number' || typeof y === 'number'
          ? ((typeof x === 'number' ? x : x === null ? 0 : Number.NaN) - (typeof y === 'number' ? y : y === null ? 0 : Number.NaN))
          : String(x ?? '').toLowerCase().localeCompare(String(y ?? '').toLowerCase());
        if (Number.isNaN(cmp)) return op === '<>';
        switch (op) { case '=': return cmp === 0; case '<>': return cmp !== 0; case '<': return cmp < 0; case '>': return cmp > 0; case '<=': return cmp <= 0; default: return cmp >= 0; }
      }
      const x = num(a), y = num(b);
      if (isErr(x)) return x; if (isErr(y)) return y;
      switch (op) {
        case '+': return x + y; case '-': return x - y; case '*': return x * y;
        case '/': return y === 0 ? new XlError('#DIV/0!') : x / y;
        case '^': return x ** y;
      }
      throw new Error(`formulaEval: operator ${op}`);
    };
    const v = expr(0);
    if (p < toks.length) throw new Error(`formulaEval: trailing tokens in ${formula}`);
    const s = scalar(v);
    return typeof s === 'boolean' ? s : s;
  }
}

/** A reader over an ExcelJS workbook's cached values. */
export function workbookReader(wb: { getWorksheet(name: string): unknown }): CellReader {
  return (sheet, r, c) => {
    const ws = wb.getWorksheet(sheet) as { getCell(r: number, c: number): { value: unknown } } | undefined;
    if (!ws) return new XlError('#REF!');
    const v = ws.getCell(r, c).value as unknown;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (v instanceof Date) return Math.round((v.getTime() - EXCEL_EPOCH) / 86_400_000);
    if (typeof v === 'object') {
      const o = v as { formula?: string; result?: unknown; text?: string; richText?: Array<{ text: string }>; error?: string };
      if ('formula' in o || 'sharedFormula' in o) {
        const res = o.result;
        if (res === undefined || res === null) return 0;
        if (typeof res === 'object' && res && 'error' in (res as object)) return new XlError(String((res as { error: string }).error));
        if (res instanceof Date) return Math.round((res.getTime() - EXCEL_EPOCH) / 86_400_000);
        return res as Scalar;
      }
      if (o.richText) return o.richText.map((x) => x.text).join('');
      if (typeof o.text === 'string') return o.text;
      if (o.error) return new XlError(o.error);
    }
    return null;
  };
}
