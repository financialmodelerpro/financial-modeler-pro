/* eslint-disable no-console */
/**
 * verify-version-naming.ts (2026-06-01)
 *
 * Pins the auto version naming + rollover engine
 * (src/hubs/modeling/platforms/refm/lib/persistence/versionNaming.ts).
 *
 * Usage: npx tsx scripts/verify-version-naming.ts
 */

import {
  getNextVersionNumber,
  buildVersionName,
  sanitizeForFilename,
  formatVersionDate,
  parseVersionLabel,
  validateTaskName,
  validateComment,
} from '../src/hubs/modeling/platforms/refm/lib/persistence/versionNaming';

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); }
};

// Versions helper: build a list with sequential created_at so "latest" is last.
const vlist = (...labels: string[]) =>
  labels.map((versionLabel, i) => ({ versionLabel, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));

console.log('=== version naming + rollover ===');

// First version.
eq('no versions -> 1.0', getNextVersionNumber([]), '1.0');

// Minor increments 1.0 -> 1.1 ... up to 1.9.
let labels: string[] = [];
let next = getNextVersionNumber(vlist(...labels));
const seq: string[] = [];
for (let i = 0; i < 11; i++) {
  seq.push(next);
  labels = [...labels, next];
  next = getNextVersionNumber(vlist(...labels));
}
eq('11-version sequence ends 1.9 -> 2.0', seq, ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.0']);

// Explicit rollover.
eq('after 1.9 -> 2.0', getNextVersionNumber(vlist('1.0', '1.5', '1.9')), '2.0');
eq('after 2.9 -> 3.0', getNextVersionNumber(vlist('2.0', '2.9')), '3.0');
eq('mid-minor 1.4 -> 1.5', getNextVersionNumber(vlist('1.0', '1.3', '1.4')), '1.5');

// Deletes do NOT fill gaps: {1.0, 1.2} (1.1 deleted) -> next 1.3.
eq('gap not filled: {1.0,1.2} -> 1.3', getNextVersionNumber(vlist('1.0', '1.2')), '1.3');

// Latest is by created_at, not numeric max.
eq('latest by created_at', getNextVersionNumber([
  { versionLabel: '1.5', createdAt: '2026-06-15T10:00:00Z' },
  { versionLabel: '1.2', createdAt: '2026-06-16T10:00:00Z' }, // created later
]), '1.3');

// Malformed labels ignored.
eq('malformed labels ignored -> 1.0', getNextVersionNumber([{ versionLabel: 'foo' }, { versionLabel: null }]), '1.0');

console.log('\n=== date + name format ===');
eq('formatVersionDate 2026-06-15 -> 06152026', formatVersionDate(new Date(2026, 5, 15)), '06152026');
eq('formatVersionDate 2026-01-02 -> 01022026', formatVersionDate(new Date(2026, 0, 2)), '01022026');
eq('buildVersionName example', buildVersionName('FMP RE HUB', '1.5', 'Debt Assumptions', new Date(2026, 5, 15)),
  'FMP RE HUB_v1.5_06152026_Debt Assumptions');

console.log('\n=== sanitize ===');
eq('sanitize slashes/colons', sanitizeForFilename('A/B:C*D?E"F<G>H|I\\J'), 'A_B_C_D_E_F_G_H_I_J');
eq('sanitize trims', sanitizeForFilename('  Hello World  '), 'Hello World');
eq('buildVersionName sanitizes project', buildVersionName('My/Project', '1.0', 'Task', new Date(2026, 5, 15)),
  'My_Project_v1.0_06152026_Task');

console.log('\n=== parse ===');
eq('parse 1.5', parseVersionLabel('1.5'), { major: 1, minor: 5 });
eq('parse 12.3', parseVersionLabel('12.3'), { major: 12, minor: 3 });
eq('parse malformed', parseVersionLabel('1'), null);

console.log('\n=== validation ===');
eq('empty task rejected', validateTaskName('').ok, false);
eq('whitespace task rejected', validateTaskName('   ').ok, false);
eq('valid task accepted', validateTaskName('Debt Assumptions_2').ok, true);
eq('51-char task rejected', validateTaskName('x'.repeat(51)).ok, false);
eq('50-char task accepted', validateTaskName('x'.repeat(50)).ok, true);
eq('special char task rejected', validateTaskName('Bad/Name').ok, false);
eq('empty comment rejected', validateComment('').ok, false);
eq('valid comment accepted', validateComment('Updated debt rate from 7% to 7.5%').ok, true);
eq('1001-char comment rejected', validateComment('x'.repeat(1001)).ok, false);
eq('1000-char comment accepted', validateComment('x'.repeat(1000)).ok, true);

console.log(`\nResults: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
