/**
 * verify-schema-drift.ts (2026-09-26)
 *
 * A migration that is in the folder but never reached the database, or a
 * database object no migration declares, FAILS the session-end suite. Until
 * now audit-schema-drift was a script run by hand, so nothing said when a new
 * migration was written and never applied.
 *
 *   A. The live schema was actually read (a failed or empty read is a FAIL,
 *      never a quiet pass).
 *   B. Every finding is ACCEPTED BY NAME in scripts/schema-drift-accepted.txt;
 *      a new one fails and is printed.
 *   C. Every accepted line is still produced; one the live schema no longer
 *      produces means the drift was resolved, so the list must drop it (the
 *      list stays a true statement, never a growing excuse).
 *   D. The comparison FIRES: run on a synthetic new finding and a synthetic
 *      resolved one, it reports each.
 *
 * It runs audit-schema-drift's own collectSchemaDrift, not a copy.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-schema-drift.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { collectSchemaDrift } from './audit-schema-drift';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? `\n${detail}` : ''}`); }
}

export function compareDrift(findings: string[], accepted: string[]): { unaccepted: string[]; resolved: string[] } {
  const acc = new Set(accepted);
  const now = new Set(findings);
  return {
    unaccepted: [...now].filter((f) => !acc.has(f)),
    resolved: [...acc].filter((a) => !now.has(a)),
  };
}

function readAccepted(): string[] {
  return readFileSync('scripts/schema-drift-accepted.txt', 'utf8')
    .split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('#'));
}

(async () => {
  const accepted = readAccepted();

  console.log('=== D. The comparison fires (synthetic) ===');
  const base = ['MISSING TABLE: a', 'UNDECLARED LIVE TABLE: b'];
  const d1 = compareDrift([...base, 'MISSING TABLE: new_one (declared in 999_x.sql)'], base);
  check('D1 a finding not on the list is reported', d1.unaccepted.length === 1 && d1.resolved.length === 0);
  const d2 = compareDrift(['MISSING TABLE: a'], base);
  check('D2 a listed finding that is gone is reported as resolved', d2.resolved.length === 1 && d2.unaccepted.length === 0);
  const d3 = compareDrift(base, base);
  check('D3 an exact match reports nothing', d3.unaccepted.length === 0 && d3.resolved.length === 0);
  check('D4 the accepted list is not empty and has no duplicates',
    accepted.length > 0 && new Set(accepted).size === accepted.length, `${accepted.length} lines`);

  console.log('\n=== A. The live schema was read ===');
  let drift;
  try {
    drift = await collectSchemaDrift(() => undefined);
  } catch (e) {
    check('A1 the live schema is readable', false, `  ${e instanceof Error ? e.message : String(e)}`);
    console.log(`\nFAILURES: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  check('A1 the live schema is readable, and it is the real one (over 100 tables exposed)', drift.liveTables > 100, `${drift.liveTables} tables`);
  check('A2 the migration folder was parsed (over 100 declared tables)', drift.declaredTables > 100, `${drift.declaredTables} tables`);

  const { unaccepted, resolved } = compareDrift(drift.findings, accepted);
  console.log(`\n=== B/C. ${drift.findings.length} findings live, ${accepted.length} accepted ===`);
  check('B1 no NEW drift: every live finding is accepted by name', unaccepted.length === 0,
    unaccepted.map((u) => `    NEW: ${u}`).join('\n')
    + '\n    A migration may be unapplied, or something created a table no migration declares. Find out which;'
    + '\n    add a line to scripts/schema-drift-accepted.txt only once you know it is acceptable.');
  check('C1 no STALE acceptance: every accepted line is still produced', resolved.length === 0,
    resolved.map((r) => `    RESOLVED: ${r}`).join('\n') + '\n    Remove these lines from scripts/schema-drift-accepted.txt.');

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();
