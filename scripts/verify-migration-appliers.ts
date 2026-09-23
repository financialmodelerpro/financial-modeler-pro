/**
 * verify-migration-appliers.ts
 *
 * AN APPLIER MAY NOT COMMIT ITS OWN PROBE ROWS.
 *
 * An applier proves a migration by writing rows: the thing that must work and
 * the thing that must fail. Those writes are a PROOF, not data. On 2026-09-22
 * two of them (245, 246) committed theirs, which put three fictional rows into
 * a real project's APPEND-ONLY audit log and a FUTURE-DATED row into the
 * unread-marker table, breaking that feature for one person until the clock
 * caught up. The dry run hid it completely, because a dry run rolls back
 * everything including the mistake.
 *
 * Every applier before 245 had deleted its probes by hand. That convention
 * held until somebody did not follow it, which is what conventions do. The
 * rule is now a SHARED HELPER plus this check:
 *
 *   A. the helper exists and ROLLS BACK rather than releases;
 *   B. every applier that writes UNDOES those writes, by any honest means;
 *   C. the ones predating the helper really do undo them, so the grandfather
 *      clause is not a free pass;
 *   D. a NEW applier has no excuse and must use the helper.
 *
 * Run: npx tsx scripts/verify-migration-appliers.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const HELPER = 'scripts/lib/migrationProbe.ts';
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

/** The helper landed at 245. Everything before it deletes its probes by hand
 *  and is excused BY NUMBER, which is a closed set that cannot grow: 245 is
 *  the first number the helper existed for. */
const HELPER_FROM = 245;

console.log('=== A. The helper undoes writes, and cannot be made to keep them ===');
{
  const h = src(HELPER);
  check('A1 the helper exists', h.length > 0, HELPER);
  check('A2 it opens a savepoint and ROLLS BACK to it',
    /savepoint \$\{name\}/.test(h) && /rollback to savepoint \$\{name\}/.test(h));
  check('A3 the rollback is in a FINALLY, so a throw inside a probe still undoes it',
    /finally\s*\{[\s\S]{0,200}rollback to savepoint/.test(h));
  check('A4 it never RELEASES a probe savepoint, which would KEEP the writes',
    !/release savepoint \$\{name\}/.test(h));
}

console.log('\n=== B/C/D. Every applier that writes is protected ===');
{
  const files = readdirSync('scripts').filter((f) => /^apply-migration-\d+\.ts$/.test(f)).sort();
  check('B0 appliers were found at all (a silent empty scan proves nothing)', files.length > 0, `${files.length}`);

  const unprotected: string[] = [];
  const grandfatheredWithoutDeletes: string[] = [];
  const newWithoutHelper: string[] = [];

  for (const f of files) {
    const num = Number(/(\d+)/.exec(f)![1]);
    const s = src(`scripts/${f}`);
    // A write is an INSERT / UPDATE / DELETE aimed at a real table. The DDL
    // itself lives in the .sql file, so anything here is the applier's own.
    const writes = /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(s);
    if (!writes) continue;
    // THE RULE IS "THE WRITES ARE UNDONE", NOT "IT USES THE HELPER".
    //
    // Re-aimed 2026-09-23, the same day it was written, after it failed 229 and
    // 232 which are both perfectly safe: they roll their probes back by hand
    // with SAVEPOINT / ROLLBACK TO SAVEPOINT and a whole-transaction ROLLBACK in
    // a finally. The first version asserted the MECHANISM (the new helper, or a
    // delete) and so reported two correct appliers as defects, which is exactly
    // the failure the standing rule in CLAUDE.md describes, committed by me one
    // day after writing that rule.
    //
    // Undo has four honest forms; any of them satisfies the rule:
    const usesHelper = /from '\.\/lib\/migrationProbe'/.test(s) && /withProbes\(/.test(s);
    const deletes = /\bdelete\s+from\b/i.test(s);
    const savepointRollback = /rollback to savepoint/i.test(s);
    const wholeRollback = /finally\s*\{[\s\S]{0,200}rollback/i.test(s) || /await c\.query\('ROLLBACK'\)/i.test(s);
    const protectedOk = usesHelper || deletes || savepointRollback || wholeRollback;

    // FORWARD-LOOKING, and deliberately stricter: a NEW applier must use the
    // helper. Hand-rolled undo is what drifted, because it is easy to write and
    // easy to leave out, and 245 and 246 left it out.
    if (num >= HELPER_FROM && !usesHelper) newWithoutHelper.push(f);
    if (!protectedOk) unprotected.push(f);
    if (num < HELPER_FROM && !protectedOk) grandfatheredWithoutDeletes.push(f);
  }

  check('B1 no applier writes with NO protection at all',
    unprotected.length === 0, unprotected.join(', '));
  check('C1 every applier predating the helper undoes its probes some honest way',
    grandfatheredWithoutDeletes.length === 0, grandfatheredWithoutDeletes.join(', '));
  check(`D1 every applier from ${HELPER_FROM} on uses the shared helper`,
    newWithoutHelper.length === 0, newWithoutHelper.join(', '));
}

console.log('\n=== E. The two that caused this are fixed, and PROVED so ===');
{
  for (const n of [245, 246]) {
    const s = src(`scripts/apply-migration-${n}.ts`);
    check(`E${n} ${n} wraps its probes in withProbes`,
      /await withProbes\(c, async \(\) => \{/.test(s) && /\}\); \/\/ withProbes/.test(s));
    check(`E${n}b ${n} uses the SHARED expectRefusal, not a local copy`,
      /expectRefusal\(c,/.test(s) && !/const expectRefusal = async/.test(s));
  }
  check('E-cleanup the one-off cleanup script for the committed rows is kept, as the record',
    src('scripts/cleanup-probe-rows-245-246.ts').includes('REMOVES THE PROBE ROWS MY OWN APPLIERS COMMITTED'));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
