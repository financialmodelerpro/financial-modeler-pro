/**
 * evaluate.ts (2026-10-20), THE STORED VALUE OF A CELL THE PLATFORM PRINTS NO FIGURE FOR.
 *
 * A live layer writes some rows of its own (the Returns workings, the helper cells that
 * keep a formula short), and the platform's hardcoded twin has no figure there, so the
 * cell was stored empty and read 0 until Excel recalculated (founder, 2026-10-20: 837 such
 * cells on Returns). This evaluates those formulas once, from the stored values of the
 * cells they read (every one the platform's own figure), so the file opens showing them.
 *
 * It is a small Excel: numbers, text, blanks and ranges; + - * / ^ & and the comparisons,
 * with arrays broadcast for SUMPRODUCT; and the functions the layers write (SUM, SUMPRODUCT,
 * SUMIF, COUNTIF, COUNT, MAX, MIN, ABS, ROUND, INT, IF, AND, OR, NOT, N, ISNUMBER,
 * IFERROR, COLUMNS, COLUMN, INDEX, MATCH, YEAR, IRR, VALUE). A formula it cannot read is
 * left as it was, never guessed. The verifier compares every value it stores with what
 * Excel computes (B5), so a wrong value here is a failed proof, not a quiet one.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

type Scalar = number | string | boolean | null;
interface Arr { rows: number; cols: number; v: Scalar[] }
type Val = Scalar | Arr | { err: string };
class Unsupported extends Error {}

const isArr = (x: Val): x is Arr => !!x && typeof x === 'object' && 'rows' in x;
const isErr = (x: Val): x is { err: string } => !!x && typeof x === 'object' && 'err' in x;

function colNum(s: string): number { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; sheet?: string; c1: number; r1: number; c2?: number; r2?: number } | { t: 'fn'; v: string } | { t: 'op'; v: string } | { t: 'bool'; v: boolean };

function tokenize(f: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const SHEET = /^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!/;
  const CELL = /^\$?([A-Z]{1,3})\$?(\d+)/;
  while (i < f.length) {
    const ch = f[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ''; for (;;) { if (j >= f.length) throw new Unsupported('string'); if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } out.push({ t: 'str', v: s }); i = j + 1; continue; }
    const rest = f.slice(i);
    const num = /^\d+(?:\.\d+)?(?:E[+-]?\d+)?/i.exec(rest);
    if (num && !/^[A-Z]/.test(rest)) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    let sheet: string | undefined;
    let k = 0;
    const sm = SHEET.exec(rest);
    if (sm) { sheet = (sm[1] ?? sm[2]).replace(/''/g, "'"); k = sm[0].length; }
    const cm = CELL.exec(rest.slice(k));
    if (cm && !/^[A-Za-z0-9_(]/.test(rest.slice(k + cm[0].length))) {
      const tok: Token = { t: 'ref', sheet, c1: colNum(cm[1]), r1: Number(cm[2]) };
      let end = k + cm[0].length;
      if (rest[end] === ':') { const c2 = CELL.exec(rest.slice(end + 1)); if (c2) { tok.c2 = colNum(c2[1]); tok.r2 = Number(c2[2]); end += 1 + c2[0].length; } }
      out.push(tok); i += end; continue;
    }
    if (sm) throw new Unsupported('sheet without a cell');
    const fn = /^([A-Z][A-Z0-9.]*)\(/.exec(rest);
    if (fn) { out.push({ t: 'fn', v: fn[1] }); i += fn[0].length; continue; }
    const b = /^(TRUE|FALSE)(?![A-Za-z0-9(])/.exec(rest);
    if (b) { out.push({ t: 'bool', v: b[1] === 'TRUE' }); i += b[0].length; continue; }
    const op = /^(<=|>=|<>|[-+*/^&=<>(),:%])/.exec(rest);
    if (op) { out.push({ t: 'op', v: op[1] }); i += op[1].length; continue; }
    throw new Unsupported(`token at ${rest.slice(0, 12)}`);
  }
  return out;
}

type Node = { k: 'lit'; v: Scalar } | { k: 'ref'; sheet?: string; c1: number; r1: number; c2?: number; r2?: number } | { k: 'fn'; name: string; args: Node[] } | { k: 'bin'; op: string; a: Node; b: Node } | { k: 'neg'; a: Node } | { k: 'pct'; a: Node };

function parse(tokens: Token[]): Node {
  let p = 0;
  const peek = (): Token | undefined => tokens[p];
  const isOp = (v: string): boolean => { const t = peek(); return !!t && t.t === 'op' && t.v === v; };
  const expect = (v: string): void => { if (!isOp(v)) throw new Unsupported(`expected ${v}`); p++; };
  const bin = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    for (;;) { const t = peek(); if (t && t.t === 'op' && ops.includes(t.v)) { p++; a = { k: 'bin', op: t.v, a, b: next() }; } else return a; }
  };
  const primary = (): Node => {
    const t = tokens[p++];
    if (!t) throw new Unsupported('end');
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'bool') return { k: 'lit', v: t.v };
    if (t.t === 'ref') return { k: 'ref', sheet: t.sheet, c1: t.c1, r1: t.r1, c2: t.c2, r2: t.r2 };
    if (t.t === 'fn') {
      const args: Node[] = [];
      if (!isOp(')')) { for (;;) { args.push(cmp()); if (isOp(',')) { p++; continue; } break; } }
      expect(')');
      return { k: 'fn', name: t.v, args };
    }
    if (t.v === '(') { const e = cmp(); expect(')'); return e; }
    if (t.v === '-') return { k: 'neg', a: unary() };
    if (t.v === '+') return unary();
    throw new Unsupported(`unexpected ${t.v}`);
  };
  const unary = (): Node => {
    let n = primary();
    while (isOp('%')) { p++; n = { k: 'pct', a: n }; }
    return n;
  };
  const pow = bin(unary, ['^']);
  const mul = bin(pow, ['*', '/']);
  const add = bin(mul, ['+', '-']);
  const cat = bin(add, ['&']);
  const cmp = bin(cat, ['=', '<>', '<', '>', '<=', '>=']);
  const root = cmp();
  if (p !== tokens.length) throw new Unsupported('trailing');
  return root;
}

const toNum = (x: Scalar): number => {
  if (typeof x === 'number') return x;
  if (x === null) return 0;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const n = Number(x); if (x.trim() !== '' && Number.isFinite(n)) return n;
  throw new Unsupported('text in arithmetic');
};
const toStr = (x: Scalar): string => (x === null ? '' : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : String(x));
const truthy = (x: Scalar): boolean => (typeof x === 'string' ? (() => { throw new Unsupported('text test'); })() : toNum(x) !== 0);
const excelRound = (x: number, d: number): number => { const m = Math.pow(10, d); return Math.sign(x) * Math.round(Math.abs(x) * m + 1e-9) / m; };

export class Evaluator {
  constructor(private readonly get: (sheet: string, row: number, col: number) => Scalar, private readonly sheet: string) {}

  value(f: string): Scalar | undefined {
    try {
      const v = this.ev(parse(tokenize(f)));
      if (isErr(v)) return undefined;
      if (isArr(v)) return v.v[0] ?? null;
      return v;
    } catch (e) { if (e instanceof Unsupported) return undefined; throw e; }
  }

  private range(n: Extract<Node, { k: 'ref' }>): Arr {
    const sh = n.sheet ?? this.sheet;
    const c2 = n.c2 ?? n.c1, r2 = n.r2 ?? n.r1;
    const rows = r2 - n.r1 + 1, cols = c2 - n.c1 + 1;
    const v: Scalar[] = [];
    for (let r = n.r1; r <= r2; r++) for (let c = n.c1; c <= c2; c++) v.push(this.get(sh, r, c));
    return { rows, cols, v };
  }
  private scalarOf(x: Val): Scalar { if (isErr(x)) throw new Unsupported('error'); if (isArr(x)) { if (x.v.length !== 1) throw new Unsupported('range as a value'); return x.v[0]; } return x; }
  private flat(args: Val[]): Scalar[] { return args.flatMap((a) => (isArr(a) ? a.v : [this.scalarOf(a)])); }
  private map2(a: Val, b: Val, f: (x: Scalar, y: Scalar) => Scalar): Val {
    if (isErr(a) || isErr(b)) return { err: 'e' };
    if (!isArr(a) && !isArr(b)) return f(a, b);
    const A = isArr(a) ? a : { rows: 1, cols: 1, v: [a] }, B = isArr(b) ? b : { rows: 1, cols: 1, v: [b] };
    const rows = Math.max(A.rows, B.rows), cols = Math.max(A.cols, B.cols);
    const at = (M: Arr, r: number, c: number): Scalar => M.v[(M.rows === 1 ? 0 : r) * M.cols + (M.cols === 1 ? 0 : c)];
    const v: Scalar[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) v.push(f(at(A, r, c), at(B, r, c)));
    return { rows, cols, v };
  }

  private ev(n: Node): Val {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': return n.c2 === undefined ? this.get(n.sheet ?? this.sheet, n.r1, n.c1) : this.range(n);
      case 'neg': { const a = this.ev(n.a); return isArr(a) ? { ...a, v: a.v.map((x) => -toNum(x)) } : isErr(a) ? a : -toNum(a); }
      case 'pct': { const a = this.scalarOf(this.ev(n.a)); return toNum(a) / 100; }
      case 'bin': {
        const a = this.ev(n.a), b = this.ev(n.b);
        const op = n.op;
        return this.map2(a, b, (x, y) => {
          switch (op) {
            case '+': return toNum(x) + toNum(y);
            case '-': return toNum(x) - toNum(y);
            case '*': return toNum(x) * toNum(y);
            case '/': { const d = toNum(y); if (d === 0) throw new Unsupported('div0'); return toNum(x) / d; }
            case '^': return Math.pow(toNum(x), toNum(y));
            case '&': return toStr(x) + toStr(y);
            default: {
              const bothNum = typeof (x ?? 0) !== 'string' && typeof (y ?? 0) !== 'string';
              const c = bothNum ? toNum(x) - toNum(y) : toStr(x).toLowerCase().localeCompare(toStr(y).toLowerCase());
              return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
            }
          }
        });
      }
      case 'fn': return this.fn(n.name, n.args);
    }
  }

  private fn(name: string, args: Node[]): Val {
    const E = (i: number): Val => this.ev(args[i]);
    const S = (i: number): Scalar => this.scalarOf(E(i));
    switch (name) {
      case 'SUM': return this.flat(args.map((a) => this.ev(a))).reduce<number>((s, x) => s + (typeof x === 'number' ? x : 0), 0);
      case 'COUNT': return this.flat(args.map((a) => this.ev(a))).filter((x) => typeof x === 'number').length;
      case 'MAX': case 'MIN': {
        const xs = this.flat(args.map((a) => this.ev(a))).filter((x): x is number => typeof x === 'number');
        if (!xs.length) return 0;
        return name === 'MAX' ? Math.max(...xs) : Math.min(...xs);
      }
      case 'SUMPRODUCT': {
        const arrs = args.map((a) => { const v = this.ev(a); return isArr(v) ? v : { rows: 1, cols: 1, v: [this.scalarOf(v)] }; });
        const len = arrs[0].v.length;
        if (arrs.some((a) => a.v.length !== len)) throw new Unsupported('sumproduct shape');
        let s = 0;
        for (let i = 0; i < len; i++) s += arrs.reduce((p, a) => p * (typeof a.v[i] === 'number' || typeof a.v[i] === 'boolean' ? toNum(a.v[i]) : 0), 1);
        return s;
      }
      case 'SUMIF': case 'COUNTIF': {
        const r = E(0); const crit = toStr(S(1));
        const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(crit)!; const op = m[1] ?? '='; const k = Number(m[2]);
        const xs = (isArr(r) ? r.v : [this.scalarOf(r)]).filter((x): x is number => typeof x === 'number');
        const ok = (x: number): boolean => (op === '>' ? x > k : op === '<' ? x < k : op === '>=' ? x >= k : op === '<=' ? x <= k : op === '<>' ? x !== k : x === k);
        return name === 'SUMIF' ? xs.filter(ok).reduce((s, x) => s + x, 0) : xs.filter(ok).length;
      }
      case 'ABS': return Math.abs(toNum(S(0)));
      case 'INT': return Math.floor(toNum(S(0)));
      case 'ROUND': return excelRound(toNum(S(0)), args.length > 1 ? toNum(S(1)) : 0);
      case 'N': { const v = E(0); const x = isArr(v) ? v.v[0] : this.scalarOf(v); return typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : 0; }
      case 'ISNUMBER': { const v = E(0); const x = isArr(v) ? v.v[0] : isErr(v) ? null : v; return typeof x === 'number'; }
      case 'IF': { const c = S(0); return truthy(c) ? (args.length > 1 ? E(1) : true) : (args.length > 2 ? E(2) : false); }
      case 'AND': return this.flat(args.map((a) => this.ev(a))).every((x) => truthy(x));
      case 'OR': return this.flat(args.map((a) => this.ev(a))).some((x) => truthy(x));
      case 'NOT': return !truthy(S(0));
      case 'IFERROR': { try { const v = E(0); return isErr(v) ? E(1) : v; } catch (e) { if (e instanceof Unsupported && /div0|irr/.test(e.message)) return E(1); throw e; } }
      case 'COLUMNS': { const v = E(0); return isArr(v) ? v.cols : 1; }
      case 'COLUMN': { const a = args[0]; if (a.k !== 'ref') throw new Unsupported('column'); if (a.c2 === undefined) return a.c1; const cols = a.c2 - a.c1 + 1; return { rows: 1, cols, v: Array.from({ length: cols }, (_, i) => a.c1 + i) }; }
      case 'INDEX': {
        const v = E(0); const A = isArr(v) ? v : { rows: 1, cols: 1, v: [this.scalarOf(v)] };
        const r = toNum(S(1)), c = args.length > 2 ? toNum(S(2)) : 1;
        if (A.rows === 1 && args.length === 2) return A.v[r - 1] ?? null;
        if (r === 0) return { rows: A.rows, cols: 1, v: Array.from({ length: A.rows }, (_, i) => A.v[i * A.cols + c - 1]) };
        return A.v[(r - 1) * A.cols + (c - 1)] ?? null;
      }
      case 'MATCH': {
        const k = S(0); const v = E(1); const xs = isArr(v) ? v.v : [this.scalarOf(v)];
        if (args.length > 2 && toNum(S(2)) !== 0) throw new Unsupported('match type');
        const i = xs.findIndex((x) => (typeof k === 'number' ? typeof x === 'number' && Math.abs(x - k) < 1e-12 : toStr(x).toLowerCase() === toStr(k).toLowerCase()));
        if (i < 0) return { err: 'na' };
        return i + 1;
      }
      case 'YEAR': {
        const x = S(0);
        // A date shown as text ("Dec 2030") reads as that month, as Excel reads it.
        if (typeof x === 'string') { const m = /(\d{4})\s*$/.exec(x.trim()); if (!m) throw new Unsupported('year of text'); return Number(m[1]); }
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(toNum(x)) * 86400000); return d.getUTCFullYear();
      }
      case 'TEXT': {
        const x = toNum(S(0)); const fmt = toStr(S(1));
        const pct = fmt.endsWith('%'); const body = pct ? fmt.slice(0, -1) : fmt;
        const m = /^(#,##)?0(?:\.(0+))?$/.exec(body);
        if (!m) throw new Unsupported(`text format ${fmt}`);
        const dp = m[2]?.length ?? 0; const v = excelRound(pct ? x * 100 : x, dp);
        const s = Math.abs(v).toFixed(dp); const [ip, fp] = s.split('.');
        const grouped = m[1] ? ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ip;
        return `${v < 0 ? '-' : ''}${grouped}${fp ? `.${fp}` : ''}${pct ? '%' : ''}`;
      }
      case 'VALUE': { const x = S(0); if (typeof x === 'number') return x; const n = Number(toStr(x).replace(/%$/, '')); if (!Number.isFinite(n) || toStr(x).trim() === '') throw new Unsupported('irr'); return /%$/.test(toStr(x)) ? n / 100 : n; }
      case 'IRR': {
        const v = E(0); const xs = (isArr(v) ? v.v : [this.scalarOf(v)]).filter((x): x is number => typeof x === 'number');
        const guess = args.length > 1 ? toNum(S(1)) : 0.1;
        let r = guess;
        for (let it = 0; it < 100; it++) {
          let f = 0, d = 0;
          xs.forEach((cf, t) => { f += cf / Math.pow(1 + r, t); d -= (t * cf) / Math.pow(1 + r, t + 1); });
          if (!Number.isFinite(f) || d === 0) throw new Unsupported('irr');
          const nr = r - f / d;
          if (Math.abs(nr - r) < 1e-12) return nr;
          r = nr;
        }
        throw new Unsupported('irr');
      }
      default: throw new Unsupported(`function ${name}`);
    }
  }
}

/**
 * Store a value in every formula cell listed (each one the layers wrote where the platform
 * prints no figure), evaluating them over and over until nothing changes (a working row can
 * read one below it). Returns the cells it filled and those it could not read.
 */
export function storeComputedValues(wb: ExcelJS.Workbook, cells: ReadonlyArray<{ sheet: string; row: number; col: number }>): { filled: number; unread: string[] } {
  const raw = (sheet: string, row: number, col: number): Scalar => {
    const c = wb.getWorksheet(sheet)?.findRow(row)?.findCell(col);
    const v = c?.value as unknown;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (v instanceof Date) return null;
    // A formula with no stored result is a figure Excel works out (a zero the writer leaves unstored),
    // never a blank: IRR skips a blank and the years would shift (2026-10-20, B5).
    if (typeof v === 'object' && 'formula' in (v as object)) { const r = (v as { result?: unknown }).result; return typeof r === 'number' || typeof r === 'string' || typeof r === 'boolean' ? r : 0; }
    if (typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join('');
    return null;
  };
  const done = new Map<string, Scalar>();
  let unread: string[] = [];
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    unread = [];
    for (const a of cells) {
      const cell = wb.getWorksheet(a.sheet)!.getCell(a.row, a.col);
      const v = cell.value as unknown as { formula?: string; result?: unknown };
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string') continue;
      const out = new Evaluator(raw, a.sheet).value(v.formula);
      const id = `${a.sheet}!R${a.row}C${a.col}`;
      if (out === undefined) { unread.push(id); continue; }
      const prev = done.get(id);
      if (prev !== out && !(typeof prev === 'number' && typeof out === 'number' && Math.abs(prev - out) <= 1e-9 * Math.max(1, Math.abs(out)))) moved = true;
      done.set(id, out);
      cell.value = { formula: v.formula, result: out === null ? undefined : out } as unknown as ExcelJS.CellValue;
    }
    if (!moved) break;
  }
  return { filled: done.size, unread };
}
