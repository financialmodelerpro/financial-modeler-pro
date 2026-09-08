/**
 * verify-rate-scale.ts (2026-09-08)
 *
 * ONE RULE, SWEPT ACROSS EVERY SURFACE THAT RENDERS MONEY:
 *
 *   A SCALE divides a figure for readability and belongs to TOTALS.
 *   A RATE is per unit and must show the whole amount.
 *
 * A per-sqm rate of 7,500 rendered at the "thousands" display scale reads "8".
 * An ADR of 1,200 reads "1". The figure is not scaled, it is destroyed, and
 * nothing on screen says so.
 *
 * WHY THIS EXISTS RATHER THAN A CHECK PER SURFACE. Four instances of this one
 * defect were found by eye, one at a time, each after shipping: the sub-unit
 * rate reading "19" for 18,500, the parcels totals rate reading "7" for
 * 7,357, the per-parcel caption reading "8" for 7,500, and the companion ADR
 * reading "1" for 1,200. Each fix was a line; the pattern was the problem. This
 * fails on the day the next one is written.
 *
 * THE EXPORTS ALREADY HAD THIS RIGHT, and their solutions are the reference:
 *   PDF   `rateUnit()` in generateProjectPdf.ts says per-unit rates are the one
 *         class of money that deliberately does NOT follow the export scale,
 *         and they carry their unit in the column header instead.
 *   Excel `NUMFMT.rate` in excel/styles.ts exists so `scaleMoneyFormats` leaves
 *         rates alone; only `money` / `money1` scale.
 * This verifier holds the on-screen tabs to the same standard.
 *
 * Run: npx tsx scripts/verify-rate-scale.ts     (no credentials needed)
 *
 * No em dashes in this file.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? `\n         ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

// ── The formatters that apply a display scale ─────────────────────────────
//
// The VALUE is the zero-based index of the scale argument, or -1 when the
// helper closes over a scale it does not take (so it always scales).
//
// Deliberately NOT listed: a bare `fmt(` and a bare `money(`. Module1Assets
// defines `fmt` as a plain toLocaleString with no scale at all, so matching the
// name alone produced four false positives on the first run. A name is only
// listed here when it unambiguously scales wherever it appears.
const SCALING: Record<string, number> = {
  formatAccounting: 1,
  formatScaled: 1,
  formatScaledForExport: 1,
  formatScaledCurrency: 2,
  fmtCurrency: 2,
  fmtMoney: -1,
  'fmt.money': -1,
  'fmt.cell': -1,
  labelMoney: -1,
};

// ── What counts as a rate ─────────────────────────────────────────────────

/**
 * REFINEMENT 1: SPLIT ON CAMEL CASE HUMPS.
 *
 * A first cut looked for a rate word at a non-letter boundary. The "Rate" in
 * `aggregate.weightedRate` is preceded by a letter, so a sabotage written to
 * exercise that very check walked straight through it.
 */
export function identWords(ident: string): string[] {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const RATE_WORDS = new Set(['rate', 'price', 'adr', 'psf', 'psm']);

/**
 * A RATE TIMES A QUANTITY IS AN AMOUNT. `pa.area * pa.rate * (pa.cashPct/100)`
 * mentions a rate and is a cash value, so a subject carrying top-level
 * arithmetic is not a rate. Depth-aware, so `(a ?? 0)` and `f(x - 1)` do not
 * count as arithmetic at the top level.
 */
export function hasTopLevelArithmetic(expr: string): boolean {
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (depth === 0 && (c === '*' || c === '+' || c === '%')) return true;
    // `/` and `-` need care: `a / b` is arithmetic, `?.` and `-` inside a
    // string are not. Only count them with whitespace on both sides.
    else if (depth === 0 && (c === '/' || c === '-') && expr[i - 1] === ' ' && expr[i + 1] === ' ') return true;
  }
  return false;
}

export function subjectIsRate(subject: string): boolean {
  if (hasTopLevelArithmetic(subject)) return false;
  const w = identWords(subject);
  // A rate ISSUE is an enum and a rate BASIS is a label; neither is money.
  if (w.includes('issue') || w.includes('basis') || w.includes('label')) return false;
  return w.some((x) => RATE_WORDS.has(x));
}

// ── Call-site parsing ─────────────────────────────────────────────────────

export function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let k = 0; k < src.length; k += 1) {
    const c = src[k];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { out.push(src.slice(start, k)); start = k + 1; }
  }
  out.push(src.slice(start));
  return out.map((x) => x.trim());
}

function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let k = openParen; k < src.length; k += 1) {
    const c = src[k];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openParen + 1, k); }
  }
  return '';
}

export interface MoneyCall {
  file: string; line: number; fn: string; args: string[]; scaleArg: string; text: string;
  /**
   * The source immediately BEFORE the call, so an allow-list entry can name the
   * branch it forgives rather than the call alone.
   *
   * THIS IS NOT DECORATION. The first allow-list entry matched on call text
   * only, and `fmt.money(l.rate)` appears in a ternary whose OTHER branch is a
   * per-unit rate. A sabotage that scaled that branch produced byte-identical
   * call text and was silently forgiven, so an allow-list written to forgive
   * one correct call had quietly forgiven a wrong one.
   */
  pre: string;
}

export function moneyCalls(file: string, src: string): MoneyCall[] {
  const out: MoneyCall[] = [];
  const names = Object.keys(SCALING).map((n) => n.replace('.', '\\.')).join('|');
  for (const m of src.matchAll(new RegExp(`(?<![A-Za-z0-9_.])(${names})\\(`, 'g'))) {
    const fn = m[1];
    const open = m.index! + fn.length;
    const args = splitArgs(callArgs(src, open));
    const at = SCALING[fn];
    out.push({
      file,
      line: src.slice(0, m.index!).split('\n').length,
      fn,
      args,
      // REFINEMENT 2: READ THE SCALE ARGUMENT BY POSITION. A first cut asked
      // whether the string 'full' appeared anywhere in the call, and
      // `project.displayScale ?? 'full'` contains it, so two sabotages passed.
      scaleArg: at < 0 ? '(closes over a scale)' : (args[at] ?? '(absent)'),
      // +2, not +1: `open` is the index of the "(", the inner text runs to the
      // ")" and a slice end is EXCLUSIVE. At +1 every captured call was missing
      // its closing paren, so no allow-list fragment could ever match and the
      // one legitimate call reported as a finding.
      text: src.slice(m.index!, open + callArgs(src, open).length + 2).replace(/\s+/g, ' '),
      pre: src.slice(Math.max(0, m.index! - 80), m.index!).replace(/\s+/g, ' '),
    });
  }
  return out;
}

/** A call is fine when the scale argument is literally 'full', or absent (the
 *  formatters all default to 'full'). */
function takesFullScale(c: MoneyCall): boolean {
  const at = SCALING[c.fn];
  if (at < 0) return false;
  const v = c.args[at];
  return v === undefined || v === "'full'";
}

// ── The allow-list ────────────────────────────────────────────────────────
//
// Each entry is a call the sweep flags and a human has judged correct, with the
// reason. Keyed on the file and a distinctive fragment of the call, so it can
// never silence a different call that happens to look similar.
const ALLOWED: { file: string; fragment: string; why: string }[] = [
  {
    file: 'src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts',
    // THE BRANCH, not just the call. `fmt.money(l.rate)` also appears in this
    // ternary's other arm, where it WOULD be wrong.
    fragment: 'l.isFixed ? fmt.money(l.rate)',
    why: "A FIXED cost line's `rate` IS its amount, not a per-unit figure. The "
      + 'same expression scales correctly here and the non-fixed branches on the '
      + 'very next operand use fmt.int, which does not scale: '
      + "`l.isFixed ? fmt.money(l.rate) : l.isPercent ? `${l.rate}%` : fmt.int(l.rate)`.",
  },
];

/** The call plus what precedes it, whitespace removed, for fragment matching. */
const allowKey = (c: MoneyCall): string => (c.pre + c.text).replace(/\s/g, '');

/**
 * A fragment must END the key, so it is anchored to THIS call.
 *
 * `includes` was not enough. The preceding-source window is 80 characters, and
 * in `l.isFixed ? fmt.money(l.rate) : l.isPercent ? ... : fmt.money(l.rate)`
 * the whole first branch sits inside the SECOND call's window, so a fragment
 * naming the first branch matched the second call too and forgave a sabotage
 * of it. Ending the key is the only position that identifies one call.
 */
function isAllowed(c: MoneyCall): { why: string } | undefined {
  const hit = ALLOWED.find((a) => c.file.endsWith(a.file.split('/').slice(-2).join('/'))
    && allowKey(c).endsWith(a.fragment.replace(/\s/g, '')));
  return hit ? { why: hit.why } : undefined;
}

// ── Surfaces ──────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const MODULES = 'src/hubs/modeling/platforms/refm/components/modules';
const SURFACES: { label: string; files: string[] }[] = [
  { label: 'Module 1 tabs', files: walk(MODULES).filter((p) => /\/Module1/.test(p)) },
  { label: 'Module 2 to 10 tabs', files: walk(MODULES).filter((p) => /\/Module(?!1[^0])/.test(p)) },
  { label: 'Shared module components', files: walk(`${MODULES}/_shared`) },
  { label: 'Excel export (live)', files: walk('src/hubs/modeling/platforms/refm/lib/excel') },
  { label: 'Excel export (legacy /api/export/excel)', files: ['src/hubs/modeling/lib/exporters/excel.ts'] },
  { label: 'PDF export', files: walk('src/hubs/modeling/platforms/refm/lib/pdf') },
  { label: 'Shared report builders', files: walk('src/hubs/modeling/platforms/refm/lib/reports') },
];

function main(): void {
  console.log('=== verify-rate-scale ===');

  // ── 0. THE DETECTOR PROVES ITSELF, on a fixture, before it is trusted on
  // real files. Every refinement below was learned from a miss.
  section('0. The detector, on a fixture that contains both answers');
  const FIXTURE = `
    const bad1 = formatAccounting(parcel.rate, scale, decimals);
    const bad2 = formatAccounting(u.unitPrice, project.displayScale ?? 'full', dec);
    const bad3 = formatAccounting(aggregate.weightedRate, s, d);
    const bad4 = fmtCurrency(avgAdr, currency, scale, dec);
    const ok1 = formatAccounting(parcel.rate, 'full', decimals);
    const ok2 = formatAccounting(aggregate.totalValue, project.displayScale ?? 'full', d);
    const ok3 = formatAccounting(pa.area * pa.rate * (pa.cashPct / 100), scale, d);
    const ok4 = formatAccounting(landReconciliation.parcelsTotalValue, scale, d);
  `;
  const fx = moneyCalls('fixture.ts', FIXTURE);
  const fxFlagged = fx.filter((c) => subjectIsRate(c.args[0] ?? '') && !takesFullScale(c));
  check('S1 the detector finds all four planted rate-with-scale calls',
    fxFlagged.length === 4, `found ${fxFlagged.length}: ${fxFlagged.map((c) => c.args[0]).join(', ')}`);
  check('S2 a scale that is the literal \'full\' is not flagged',
    !fxFlagged.some((c) => c.args[0] === 'parcel.rate' && c.args[1] === "'full'"));
  check('S3 `project.displayScale ?? \'full\'` IS flagged (the first cut matched the word anywhere)',
    fxFlagged.some((c) => c.args[0] === 'u.unitPrice'));
  check('S4 a camelCase rate IS flagged (the second cut needed a non-letter boundary)',
    fxFlagged.some((c) => c.args[0] === 'aggregate.weightedRate'));
  check('S5 a rate TIMES a quantity is an amount, and is not flagged',
    !fxFlagged.some((c) => (c.args[0] ?? '').includes('pa.area')));
  check('S6 a scaled TOTAL is not flagged',
    !fxFlagged.some((c) => /totalValue|parcelsTotalValue/.test(c.args[0] ?? '')));
  check('S7 identWords splits camel case, dots and underscores',
    JSON.stringify(identWords('aggregate.weightedRate')) === '["aggregate","weighted","rate"]'
    && JSON.stringify(identWords('u.unitPrice')) === '["u","unit","price"]');

  // ── 1. The sweep itself.
  section('1. Every surface that renders money');
  const findings: MoneyCall[] = [];
  const allowedHits: { c: MoneyCall; why: string }[] = [];
  let scannedAll = 0;
  const scaledTotalsBySurface = new Map<string, number>();

  for (const { label, files } of SURFACES) {
    let scanned = 0, scaledTotals = 0;
    const mine: MoneyCall[] = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      const calls = moneyCalls(f, readFileSync(f, 'utf8'));
      scanned += calls.length;
      for (const c of calls) {
        // A scaled TOTAL is the thing the scale is FOR. Counted so the sweep
        // can prove it is looking at something.
        if (!subjectIsRate(c.args[0] ?? '') && !takesFullScale(c)) scaledTotals += 1;
        if (!subjectIsRate(c.args[0] ?? '')) continue;
        if (takesFullScale(c)) continue;
        const allowed = isAllowed(c);
        if (allowed) { allowedHits.push({ c, why: allowed.why }); continue; }
        mine.push(c);
      }
    }
    scannedAll += scanned;
    scaledTotalsBySurface.set(label, scaledTotals);
    findings.push(...mine);
    console.log(`  ${label}: ${files.length} files, ${scanned} money renders, ${scaledTotals} scaled totals, ${mine.length} findings`);
    for (const c of mine) console.log(`      ${c.file}:${c.line}  ${c.fn}(${c.args[0]}, ...) scale = ${c.scaleArg}`);
  }

  check('A1 no RATE anywhere takes the display scale',
    findings.length === 0,
    findings.map((c) => `${c.file}:${c.line} ${c.fn}(${c.args[0]}) scale=${c.scaleArg}`).join('\n         '));

  // ── 2. Negative controls. A sweep that matches nothing passes everything.
  section('2. The sweep is actually looking');
  // A FLOOR, NOT A TARGET. It is here so a broken regex or a moved folder
  // cannot report a clean sweep of nothing; the real count today is about 185.
  check('A2 it scanned a realistic number of money renders across the platform',
    scannedAll >= 120, `${scannedAll} scanned`);
  check('A3 it SEES scaled totals on the tabs and in both exports, so it cannot pass by matching nothing',
    (scaledTotalsBySurface.get('Module 1 tabs') ?? 0) > 0
    && (scaledTotalsBySurface.get('PDF export') ?? 0) > 0
    && (scaledTotalsBySurface.get('Excel export (live)') ?? 0) > 0,
    JSON.stringify(Object.fromEntries(scaledTotalsBySurface)));
  // THE SHARED REPORT BUILDERS ARE DELIBERATELY NOT IN THAT LIST. They compute
  // numbers and let each surface format them, so they call no scaling formatter
  // at all. They stay in the sweep so that changing their mind about it is
  // caught on the day it happens.
  check('A3b the report builders still format nothing themselves',
    (scaledTotalsBySurface.get('Shared report builders') ?? 0) === 0);
  check('A4 every surface was found on disk (a renamed folder must not read as clean)',
    SURFACES.every((s) => s.files.filter((f) => existsSync(f)).length > 0),
    SURFACES.filter((s) => s.files.filter((f) => existsSync(f)).length === 0).map((s) => s.label).join(', '));

  // ── 3. The allow-list stays honest.
  section('3. The allow-list');
  console.log(`  ${ALLOWED.length} entry(s), ${allowedHits.length} matched this run`);
  for (const { c, why } of allowedHits) console.log(`      ${c.file}:${c.line}  ${c.fn}(${c.args[0]})\n         reason: ${why}`);
  const matchCount = (a: typeof ALLOWED[number]): number =>
    allowedHits.filter(({ c }) => allowKey(c).endsWith(a.fragment.replace(/\s/g, ''))).length;
  check('A5 every allow-list entry still matches a real call (a stale entry is a hole)',
    ALLOWED.every((a) => matchCount(a) >= 1),
    ALLOWED.filter((a) => matchCount(a) === 0).map((a) => a.fragment).join(', '));
  // AN ENTRY THAT FORGIVES TWO CALLS IS TOO BROAD, and that is not theoretical:
  // the first version of the entry below matched on call text alone and
  // forgave both arms of a ternary, one of which a sabotage had made wrong.
  check('A5b no allow-list entry forgives more than the ONE call it names',
    ALLOWED.every((a) => matchCount(a) === 1),
    ALLOWED.filter((a) => matchCount(a) > 1).map((a) => `${a.fragment} x${matchCount(a)}`).join(', '));
  check('A6 every allow-list entry carries a reason',
    ALLOWED.every((a) => a.why.trim().length > 40));

  // ── 4. The two export conventions this verifier holds the tabs to.
  section('4. The export conventions are still in place');
  const pdfSrc = existsSync('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts')
    ? readFileSync('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts', 'utf8') : '';
  const xlStyles = existsSync('src/hubs/modeling/platforms/refm/lib/excel/styles.ts')
    ? readFileSync('src/hubs/modeling/platforms/refm/lib/excel/styles.ts', 'utf8') : '';
  check('A7 the PDF still labels per-unit rate columns with their unit',
    /function rateUnit\(/.test(pdfSrc) && (pdfSrc.match(/rateUnit\(/g) ?? []).length >= 4);
  check('A8 Excel still keeps a rate number format distinct from money, and scales only money',
    /rate: accountingFormat\(/.test(xlStyles)
    && /cell\.numFmt === NUMFMT\.money/.test(xlStyles)
    && !/cell\.numFmt === NUMFMT\.rate/.test(xlStyles));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
