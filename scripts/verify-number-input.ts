/**
 * verify-number-input.ts (2026-10-07, founder)
 *
 * A NUMBER FIELD REFUSES A FIGURE IT CANNOT HOLD EXACTLY.
 *
 * The committed existing-operations capture, a real saved version, carries a
 * phase `historicalCapexTotal` of 36820510001282052000: '3682051000' (the
 * asset's own pre-capex) with '1282052000' appended, typed into one field
 * before May 2026, when that field still had an input. AccountingNumberInput
 * had no limit, so every one of its fields would still accept such a figure
 * today and store it beyond 2^53, where it is not exact. parseAccounting now
 * refuses it, and the field reverts as it does for any unreadable text.
 *
 * The stored value itself is left in the capture on purpose (its worth is that
 * a real platform wrote it) and this proves nothing reads it.
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { parseAccounting } from '../src/hubs/modeling/platforms/refm/components/ui/AccountingNumberInput';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

console.log('=== The accounting number field ===');
check('refuses the two-figures-in-one value the saved capture holds', parseAccounting('36820510001282052000') === null);
check('refuses it with separators too', parseAccounting('36,820,510,001,282,052,000') === null);
check('refuses it negative, in parentheses', parseAccounting('(36820510001282052000)') === null);
check('accepts the largest exact number (not vacuous: the limit is the edge, not lower)', parseAccounting(String(Number.MAX_SAFE_INTEGER)) === Number.MAX_SAFE_INTEGER);
check('and one past it is refused', parseAccounting('9007199254740993') === null);
check('ordinary figures are unchanged: commas, parentheses, a blank', parseAccounting('3,682,051,000') === 3682051000 && parseAccounting('(1,250)') === -1250 && parseAccounting('') === 0 && parseAccounting('12.5') === 12.5);
check('text still reverts (null), as before', parseAccounting('abc') === null);

console.log('\n=== The stored value is inert ===');
const capture = JSON.parse(readFileSync('scripts/fixtures/existingOperationsProject.json', 'utf8'));
const stored = capture.phases.find((p: any) => p.id === 'phase_1')?.historicalBaseline?.historicalCapexTotal;
check('the capture still carries it (the finding is real, not reconstructed)', typeof stored === 'number' && stored > Number.MAX_SAFE_INTEGER, String(stored));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const readers = [...walk('src'), ...walk('app')].flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/)
  .filter((l) => /historicalCapexTotal/.test(l) && !/^\s*(\/\/|\*)/.test(l)).map((l) => `${f}: ${l.trim()}`));
const nonInert = readers.filter((l) => !/historicalCapexTotal: (0|number);/.test(l.split(': ').slice(1).join(': ')) && !/historicalCapexTotal: 0,/.test(l));
check('nothing in the app reads historicalCapexTotal (only its type and a seed of 0 name it)', nonInert.length === 0, nonInert.join(' | '));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail === 0 ? 0 : 1);
