/**
 * verify-email-escaping.ts (2026-08-20)
 *
 * NO EMAIL TEMPLATE INTERPOLATES ITS OWN INPUT INTO HTML UNESCAPED.
 *
 * This checks the CLASS, not a list of known-bad lines. A template's inputs
 * are almost always typed by somebody else (a student's name and notes, an
 * uploaded file name, a registrant's company), and several of these emails go
 * to an internal inbox we read and act on. Interpolated raw, a value can
 * inject markup, a plausible link to somewhere else, or a broken tag that
 * swallows the rest of the message so the part you needed never renders.
 *
 * THE RULE ENFORCED HERE: inside a template file, every `${...}` that
 * references one of that function's own PARAMETERS must pass through
 * `escapeHtml` / `escapeHtmlMultiline`, unless the line is explicitly and
 * visibly exempted.
 *
 * Two exemptions exist, both narrow and both requiring the exemption to be
 * written down next to the code:
 *
 *   TEXT PART. The plain-text half of an email must NOT be escaped: entities
 *   would render literally to the reader. Marked with `plain-text-safe`.
 *
 *   ALREADY-SAFE VALUE. A value the code itself built (a URL from a constant,
 *   a number, a formatted date). Marked with `html-safe:` plus the reason.
 *
 * Found live on 2026-08-20 in FIVE templates at once, including one already
 * receiving student-written notes in production.
 *
 * Run: npx tsx scripts/verify-email-escaping.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 56 - t.length))}`);

const $dollar = String.fromCharCode(36);
const $open = String.fromCharCode(123);
const $close = String.fromCharCode(125);

const DIR = 'src/shared/email/templates';
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Escaping helpers, plus anything that provably yields safe output. */
// Escaping helpers, plus builders that provably escape their own input.
// descriptionToEmailHtml escapes every line it emits (see its flushPara /
// bullet paths); allowing it is not a hole, and forcing a double escape
// there would print entities to a reader.
// Calls whose result is already safe. Every entry here escapes its own inputs,
// and section A pins that for each one: an entry on this list whose function
// stopped escaping would turn the whole of section B into a check that passes
// for the wrong reason.
const SAFE_CALLS = ['escapeHtml(', 'escapeHtmlMultiline(', 'esc(', 'encodeURIComponent(', 'descriptionToEmailHtml(', 'orNone(', 'greeting(', 'button('];

/** Lines a template can exempt, in writing, next to the code. */
const EXEMPT_MARKERS = ['plain-text-safe', 'html-safe:'];

/**
 * The parameter names a template destructures, which is what "its own input"
 * means. Covers both shapes used here: `function t({ a, b }: T)` and
 * `function t(d: T)` where the body then reads `d.a`.
 */
function paramNames(src: string): { names: Set<string>; objectParams: Set<string> } {
  const names = new Set<string>();
  const objectParams = new Set<string>();
  // Destructured: export async function xTemplate({ a, b, c }: Data)
  for (const m of src.matchAll(/export async function \w+\s*\(\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.split(':')[0].split('=')[0].trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) names.add(n);
    }
  }
  // Object param: export async function xTemplate(d: Data)
  for (const m of src.matchAll(/export async function \w+\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
    objectParams.add(m[1]);
  }
  return { names, objectParams };
}

/**
 * Every `${...}` in the file, brace-balanced.
 *
 * A naive /${([^}]*)}/ stops at the FIRST closing brace, so
 * `${p(`... ${x} ...`)}` is captured as a truncated fragment and reported as
 * an offender it is not. That produced four false positives on the first run,
 * which is exactly how a checker gets switched off. Balance the braces.
 */
function interpolations(src: string): Array<{ expr: string; line: number }> {
  const out: Array<{ expr: string; line: number }> = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== $dollar || src[i + 1] !== $open) continue;
    let depth = 1;
    let j = i + 2;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === $open) depth += 1;
      else if (src[j] === $close) depth -= 1;
    }
    const expr = src.slice(i + 2, j - 1);
    out.push({ expr, line: src.slice(0, i).split(String.fromCharCode(10)).length });
    i = j - 1;
  }
  return out;
}
section('A. Every template file is inspected');

const files = fs.readdirSync(path.join(process.cwd(), DIR))
  .filter((f) => f.endsWith('.ts') && f !== '_base.ts')
  .sort();

check('A: the sweep found the templates at all', files.length >= 15, String(files.length));

// The shared helpers exist and are the only implementation.
{
  const base = read(`${DIR}/_base.ts`);
  check('A: the shared escape helper exists in _base', base.includes('export function escapeHtml('));
  check('A: and a multiline form, which escapes BEFORE inserting the breaks',
    base.includes('export function escapeHtmlMultiline(')
    && /escapeHtml\(v\)\.replace\(\/\\r\?\\n\/g, '<br\/>'\)/.test(base));
  // A private copy in a template is a second thing to get wrong.
  const copies = files.filter((f) => /^function esc(apeHtml)?\s*\(/m.test(read(`${DIR}/${f}`)));
  check('A: no template declares its own escape function', copies.length === 0, copies.join(', '));

  // EVERY SAFE_CALLS ENTRY DEFINED IN _base.ts MUST ACTUALLY ESCAPE.
  //
  // Section B treats a call to one of these as already safe and stops looking.
  // That is only true while the function still escapes, and nothing said so:
  // The button entry was added to the list on 2026-08-31 precisely because it
  // now escapes its href, and an entry that outlived its behaviour would
  // silently exempt thirty call sites.
  for (const entry of SAFE_CALLS) {
    const fn = entry.slice(0, -1);
    // escapeHtml itself IS the escaper, and encodeURIComponent is a builtin.
    if (fn === 'escapeHtml' || fn === 'escapeHtmlMultiline' || fn === 'encodeURIComponent') continue;
    // Wherever it is defined: a function declaration in _base.ts, or a const
    // arrow / local in the template that uses it. greeting() is all three.
    //
    // THE WINDOW IS THE WHOLE FUNCTION, not a fixed slice. The first version
    // read 600 characters from the declaration and reported
    // descriptionToEmailHtml as unescaped: its two escapeHtml calls sit about
    // twenty-five lines in, past the window. A check that reports a safe
    // function as unsafe is as useless as one that misses a hole, and it was
    // the check that had to change, not the code.
    //
    // ROUTING THROUGH THE SHARED ESCAPER, DIRECTLY OR NOT, is the property.
    // `const esc = escapeHtml` is an alias, so the paren never appears; orNone
    // escapes by calling esc(). Both are safe, and a rule that only accepted a
    // literal `escapeHtml(` would have forced a pointless rewrite of both.
    const trusted = SAFE_CALLS.map((c) => c.slice(0, -1)).filter((n) => n !== fn);
    const defs: string[] = [];
    for (const f of ['_base.ts', ...files]) {
      const src = read(`${DIR}/${f}`);
      const at = src.search(new RegExp(`(?:export )?(?:function|const) ${fn}\\b`));
      if (at < 0) continue;
      // To the first line that closes a top-level block, which is the end of
      // the declaration for every shape used here.
      const rest = src.slice(at);
      const end = rest.search(/\n\}|\n;/);
      defs.push(end > 0 ? rest.slice(0, end) : rest.slice(0, 3000));
    }
    if (defs.length === 0) continue;
    const routes = (d: string): boolean =>
      /escapeHtml\b/.test(d) || trusted.some((n) => new RegExp(`\\b${n}\\(`).test(d));
    check(`A: ${fn}(), trusted by section B, routes its input through the shared escaper`,
      defs.every(routes), `${defs.length} definition(s), ${defs.filter((d) => !routes(d)).length} unrouted`);
  }
  // The specific reason button() joined the list: the HREF, not just the label.
  check('A: button() escapes the href, not just the label',
    /href="\$\{escapeHtml\(href\)\}"/.test(base));
}

section('B. No parameter is interpolated into HTML unescaped');

{
  const offenders: string[] = [];
  let inspected = 0;

  for (const file of files) {
    const src = read(`${DIR}/${file}`);
    const { names, objectParams } = paramNames(src);
    // Values this file declares safe, as `html-safe: name reason` in a comment.
    const fileExempt = [...src.matchAll(/html-safe:\s*([a-zA-Z_][a-zA-Z0-9_.]*)/g)].map((m) => m[1]);
    if (names.size === 0 && objectParams.size === 0) continue;
    inspected += 1;

    // A plain-text block runs to the end of the function, and it is often 10
    // lines long, so `plain-text-safe` is a BLOCK marker, not a line one: it
    // exempts from its own line to the closing `return {`. A per-line
    // lookback demanded the marker be repeated on every line of a text
    // template, which nobody would do and which would read as noise.
    const textFrom = src.split(String.fromCharCode(10))
      .findIndex((l) => l.includes('plain-text-safe: the text half'));

    for (const { expr, line } of interpolations(src)) {
      // EXEMPTED IN WRITING, at FILE level.
      //
      // Deliberately not a per-line comment: these interpolations sit INSIDE
      // template literals, so a // comment beside one is not a comment at all,
      // it is text that prints into the email. (Tried it; it rendered
      // "// html-safe: ..." above the confirm button.) A file-level
      // declaration is also the more honest shape: it names the VALUE that is
      // safe and why, once, where a reader will find it.
      if (textFrom >= 0 && line > textFrom) continue;
      if (fileExempt.some((n) => new RegExp(`(^|[^a-zA-Z0-9_.])${n}([^a-zA-Z0-9_]|$)`).test(expr))) continue;
      // Exempted in writing, on the line or the two above it.
      const context = src.split('\n').slice(Math.max(0, line - 3), line).join('\n');
      if (EXEMPT_MARKERS.some((m) => context.includes(m))) continue;
      // Already escaped.
      if (SAFE_CALLS.some((c) => expr.includes(c))) continue;
      // A ternary is fine when BOTH sides are safe or literal.
      const bare = expr.replace(/\s/g, '');

      // STRIP QUOTED PROSE BEFORE LOOKING FOR PARAM NAMES.
      //
      // Without this, `${p('... enter the code below ...')}` is flagged
      // because the English word "code" matches a parameter called `code`.
      // Three of the first run's four reports were exactly that, and a
      // checker that cries wolf is a checker somebody switches off. Single and
      // double quoted segments are inert text; BACKTICK segments are kept,
      // because they can interpolate.
      const searchable = expr
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');

      // Does the expression reference an input?
      const touchesParam =
        [...names].some((n) => new RegExp(`(^|[^a-zA-Z0-9_.])${n}([^a-zA-Z0-9_]|$)`).test(searchable))
        || [...objectParams].some((d) => new RegExp(`(^|[^a-zA-Z0-9_])${d}\\.`).test(searchable));
      if (!touchesParam) continue;

      // Numbers and lengths cannot carry markup.
      if (/\.length\b/.test(bare) && !/[a-zA-Z_]\w*\s*\?/.test(bare)) continue;

      offenders.push(`${file}:${line}  \${${expr.trim().slice(0, 60)}}`);
    }
  }

  check('B: templates with inputs were actually inspected', inspected >= 10, String(inspected));
  check('B: no template interpolates an input unescaped',
    offenders.length === 0, offenders.slice(0, 8).join(' | '));
}

section('C. The templates that were fixed stay fixed');

{
  // Instance checks BESIDE the class check, not instead of it. These name the
  // five that were live so a regression reads as a named failure rather than
  // as an anonymous one from section B.
  const cases: Array<[string, string[]]> = [
    ['modelSubmissionAdminAlert.ts', ['escapeHtmlMultiline(studentNotes)', 'escapeHtml(studentEmail)']],
    ['modelSubmissionApproved.ts', ['escapeHtmlMultiline(reviewerNote)']],
    ['modelSubmissionRejected.ts', ['escapeHtmlMultiline(reviewerNote)']],
    ['modelSubmissionStaleDigest.ts', ['escapeHtml(r.studentEmail)']],
    ['modelSubmissionNoticeBroadcast.ts', ['escapeHtml(studentName.trim())']],
  ];
  for (const [file, probes] of cases) {
    const src = read(`${DIR}/${file}`);
    for (const probe of probes) {
      check(`C: ${file} escapes ${probe.split('(')[1]?.replace(')', '') ?? probe}`, src.includes(probe));
    }
    // The old raw pattern must be gone, not merely joined by a safe one.
    check(`C: ${file} has no raw newline-to-br left`,
      !/\$\{[a-zA-Z_][a-zA-Z0-9_.]*\.replace\(\/\\n\/g, '<br\/>'\)\}/.test(src));
  }
}

section('D. The plain-text parts are deliberately NOT escaped');

{
  // Escaping the text half would print &amp; and &#39; to a reader. The
  // exemption is real, and it must stay marked so it reads as a decision.
  for (const file of ['modelSubmissionStaleDigest.ts', 'modelSubmissionNoticeBroadcast.ts']) {
    const src = read(`${DIR}/${file}`);
    check(`D: ${file} marks its text part as deliberately raw`,
      src.includes('plain-text-safe') || src.includes('NOT escaped'));
  }
  const broadcast = read(`${DIR}/modelSubmissionNoticeBroadcast.ts`);
  check('D: the broadcast keeps separate html and text greetings',
    broadcast.includes('greetingText') && broadcast.includes('escapeHtml(studentName.trim())'));
}

console.log(`\n${'='.repeat(62)}`);
if (failures.length === 0) {
  console.log(`verify-email-escaping: ${passed} passed, 0 failed`);
} else {
  console.log(`verify-email-escaping: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
