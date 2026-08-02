/**
 * verify-no-em-dash-content.ts (house style: no em dashes in user-facing text)
 *
 * The no-em-dash rule was enforced in two narrow ways: a hardcoded file list
 * inside individual verifiers (opt in, so any NEW file was unguarded until
 * somebody remembered to add it), and the REFM AI narrative sanitizer. Nothing
 * swept the tree, so the rule held only where it had been remembered.
 *
 * This is the repo-wide sweep. It walks every source file that can put text in
 * front of a user and fails on a literal em dash (U+2014) or horizontal bar
 * (U+2015), then pins the shared sanitizer that catches the runtime cases a
 * static sweep cannot see.
 *
 * WHAT IS IN SCOPE, and why the scope is not "everything":
 *
 *   * User-facing source (app/, src/) IS swept. UI copy, email templates, deck
 *     and report text, AI prompts, error and notice strings all live here.
 *   * Code COMMENTS are swept too, deliberately. A comment is not user facing,
 *     but allowing them means the sweep has to parse comments to tell the two
 *     apart, and a parser is a thing that can be wrong. The rule is cheap to
 *     follow, so the sweep stays dumb and total.
 *   * scripts/ is NOT swept: several verifiers legitimately hold an em dash
 *     inside the assertion that hunts for one.
 *   * Markdown, migrations and _legacy_backup are NOT swept. Docs are internal,
 *     applied migrations must never be edited, and the legacy static assets are
 *     not referenced by the app.
 *
 * The en dash U+2013 is NOT swept. It is legitimate in numeric ranges and is a
 * deliberate "not included" glyph in the pricing comparison table.
 *
 * No em dashes in this file: the characters are built from escapes.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripEmDashes, containsEmDash, stripEmDashesDeep } from '../src/shared/text/houseStyle';
import { sanitizeNarrativeText } from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrative';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };

const EM = String.fromCharCode(0x2014);
const HB = String.fromCharCode(0x2015);
const DASH_RE = new RegExp(`[${EM}${HB}]`, 'g');

const ROOT = join(__dirname, '..');
const SWEEP_DIRS = ['app', 'src'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '_legacy_backup', 'dist', 'build']);
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((x) => e.endsWith(x))) out.push(full);
  }
  return out;
}

console.log('== repo sweep: no em dash in user-facing source ==');
{
  const files = SWEEP_DIRS.flatMap((d) => walk(join(ROOT, d)));
  check(`sweep found source files to check (${files.length})`, files.length > 200);

  const offenders: Array<{ file: string; line: number; text: string }> = [];
  for (const f of files) {
    let src: string;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    if (!DASH_RE.test(src)) { DASH_RE.lastIndex = 0; continue; }
    DASH_RE.lastIndex = 0;
    src.split('\n').forEach((line, i) => {
      if (new RegExp(`[${EM}${HB}]`).test(line)) {
        offenders.push({ file: relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, text: line.trim().slice(0, 110) });
      }
    });
  }

  if (offenders.length) {
    console.log(`\n  ${offenders.length} offending line(s):`);
    offenders.slice(0, 40).forEach((o) => console.log(`    ${o.file}:${o.line}  ${o.text}`));
    if (offenders.length > 40) console.log(`    ... and ${offenders.length - 40} more`);
    console.log('');
  }
  check('no em dash in any app/ or src/ source file', offenders.length === 0);
}

console.log('== the sweep has teeth (it can actually fail) ==');
{
  // A sweep that cannot detect a planted violation proves nothing.
  const planted = `const copy = 'clause one ${EM} clause two';`;
  check('detects a planted em dash', new RegExp(`[${EM}${HB}]`).test(planted));
  const plantedBar = `const copy = 'clause one ${HB} clause two';`;
  check('detects a planted horizontal bar', new RegExp(`[${EM}${HB}]`).test(plantedBar));
  check('does not flag a hyphen', !new RegExp(`[${EM}${HB}]`).test('cost-effective, three-statement'));
  check('does not flag an en dash (ranges and table glyphs are allowed)',
    !new RegExp(`[${EM}${HB}]`).test(`0${String.fromCharCode(0x2013)}100`));
}

console.log('== shared sanitizer: the runtime half ==');
{
  check('spaced dash becomes a comma', stripEmDashes(`clause one ${EM} clause two`) === 'clause one, clause two');
  check('tight dash becomes a comma plus a space', stripEmDashes(`cost${EM}value`) === 'cost, value');
  check('horizontal bar is treated the same', stripEmDashes(`cost ${HB} value`) === 'cost, value');
  check('several dashes in one string all go', !containsEmDash(stripEmDashes(`a ${EM} b ${EM} c`)));
  check('text with no dash is returned untouched', stripEmDashes('Plain sentence, unchanged.') === 'Plain sentence, unchanged.');
  check('a hyphen is preserved', stripEmDashes('three-statement model') === 'three-statement model');
  check('an en dash is preserved', stripEmDashes(`0${String.fromCharCode(0x2013)}100`) === `0${String.fromCharCode(0x2013)}100`);
  check('containsEmDash is true before and false after', containsEmDash(`a ${EM} b`) && !containsEmDash(stripEmDashes(`a ${EM} b`)));
  check('containsEmDash tolerates a non-string', !containsEmDash(null) && !containsEmDash(42));
  check('containsEmDash is not sticky across calls (lastIndex reset)',
    containsEmDash(`a ${EM} b`) && containsEmDash(`c ${EM} d`) && containsEmDash(`e ${EM} f`));
}

console.log('== deep sanitizer: whole records of seeded narrative ==');
{
  const rec = {
    executiveSummary: `The scheme is funded ${EM} largely by senior debt.`,
    risks: [{ risk: `Cost overrun ${EM} on the podium`, mitigant: 'Fixed price contract' }],
    nested: { conditions: [`Planning consent ${EM} in full`] },
    untouched: 42,
    nullish: null,
  };
  const out = stripEmDashesDeep(rec);
  check('strings at the top level are cleaned', !containsEmDash(out.executiveSummary));
  check('strings inside an array of objects are cleaned', !containsEmDash(out.risks[0].risk));
  check('strings nested in an object inside an array are cleaned', !containsEmDash(out.nested.conditions[0]));
  check('non-string values pass through', out.untouched === 42 && out.nullish === null);
  check('nothing anywhere in the record still carries one', !containsEmDash(JSON.stringify(out)));
  check('the input record is not mutated', containsEmDash(rec.executiveSummary));
}

console.log('== AI narrative path still enforces it (unchanged behaviour) ==');
{
  check('AI output shaping strips a spaced dash',
    sanitizeNarrativeText(`The IRR is strong ${EM} driven by the exit.`) === 'The IRR is strong, driven by the exit.');
  check('AI output shaping strips a tight dash', sanitizeNarrativeText(`cost${EM}value`) === 'cost, value');
  check('AI output shaping still unwraps a code fence', sanitizeNarrativeText('```\nPlain text.\n```') === 'Plain text.');
  check('AI output shaping still unwraps matched quotes', sanitizeNarrativeText('"Just the paragraph."') === 'Just the paragraph.');
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
