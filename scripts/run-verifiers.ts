/**
 * run-verifiers.ts
 *
 * THE suite runner. Runs every `scripts/verify-*.ts` and reports one number.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Until 2026-09-02 the suite had NO committed runner. Every session invented a
 * shell loop, and every one of them invoked `npx tsx <file>` WITHOUT
 * `--env-file=.env.local`. Fourteen verifiers have a LIVE half that reads the
 * database or a deployed endpoint, and several of those skip themselves when
 * credentials are absent, printing a quiet SKIP line and then reporting
 * "N passed, 0 failed".
 *
 * The cost was not theoretical. `verify-admin-users-cleanup` runs the exact
 * PostgREST embed that `/api/admin/users` depends on and compares it against a
 * direct count. When migration 231 made that embed ambiguous and the entire
 * admin user list went blank in production, that verifier printed
 * "SKIP A4/A5 (no DB creds)" and "20 passed, 0 failed". The suite reported
 * 151/0 while the page was down. The check was correct, complete, and never
 * ran.
 *
 * ── THE RULES THIS RUNNER ENFORCES ────────────────────────────────────────
 *
 * 1. CREDENTIALS ARE LOADED BY DEFAULT. `.env.local` is passed to every
 *    verifier, so live halves actually execute.
 * 2. A SKIPPED LIVE CHECK IS LOUD. Any verifier that prints a skip marker is
 *    listed in its own section with the reason, and the run FAILS. A skip is
 *    a coverage hole, and a coverage hole must never be reported as a pass.
 * 3. RUNNING WITHOUT CREDENTIALS IS AN EXPLICIT CHOICE. Without `.env.local`
 *    the runner refuses unless `--allow-offline` is passed, and even then it
 *    labels the result as PARTIAL so the number is never quoted as the suite.
 *
 * Usage:
 *   npx tsx scripts/run-verifiers.ts                 (full, credentials loaded)
 *   npx tsx scripts/run-verifiers.ts --allow-offline (static half only)
 *   npx tsx scripts/run-verifiers.ts --filter admin  (subset, same rules)
 *
 * No em dashes in this file.
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ALLOW_OFFLINE = process.argv.includes('--allow-offline');
const filterIdx = process.argv.indexOf('--filter');
const FILTER = filterIdx >= 0 ? process.argv[filterIdx + 1] ?? '' : '';

const ENV_FILE = '.env.local';
const haveEnv = existsSync(ENV_FILE);

// Markers a verifier prints when it declines to run part of itself.
//
// ANCHORED AT THE START OF THE LINE, and case-sensitive, deliberately. The
// first version of this matched /\bskip/i anywhere in a line and reported ten
// verifiers as skipping when only two were: it was matching the PROSE inside
// passing checks, such as
//   [PASS] a recipient with no token is skipped, never emailed
// A check that PASSES while describing skip behaviour is the opposite of a
// skipped check. That is TRAPS 3.17 in this very file, written an hour after
// the entry describing it, which is why the rule is now structural: a skip is
// a line that BEGINS by announcing itself as one.
const SKIP_MARKER = /^(\[SKIP\]|SKIP\b)/;
/** A tally line saying nothing was skipped is not a skip. */
const ZERO_SKIPPED = /\b0 skipped\b/;

/**
 * Skips that are UNDERSTOOD and accepted, each with the reason it is not a
 * coverage hole worth failing on.
 *
 * This list exists so the runner can stay meaningful. A runner that is
 * permanently red because of two known, explained skips teaches everyone to
 * ignore it, which is exactly how the silent skip survived in the first place.
 * Anything NOT on this list fails the run, and adding an entry is a code change
 * somebody has to justify, so the list cannot rot quietly the way a runtime
 * flag would.
 */
const ACCEPTED_SKIPS: Record<string, string> = {
  'verify-psync.ts':
    'Needs a dev server on localhost:3000. It skips the live leg rather than failing, '
    + 'and the static leg still runs. Start `npm run dev` to cover the rest.',
  'verify-module6-field-census.ts':
    'Per-FIELD skips for levers whose override path is not in the catalog. These are '
    + 'the census reporting what it could not probe, which is the honest behaviour it '
    + 'was rebuilt for, not a credential gap.',
};
const TALLY = /(\d+) passed, (\d+) failed/;

function main(): void {
  if (!haveEnv && !ALLOW_OFFLINE) {
    console.error(`\nREFUSING TO RUN: ${ENV_FILE} is missing.`);
    console.error('Fourteen verifiers have a live half that silently skips without credentials,');
    console.error('and a suite that skips its live checks reports a number it has not earned.');
    console.error('Run with --allow-offline to measure the static half only, knowing it is partial.\n');
    process.exit(2);
  }

  const files = readdirSync('scripts')
    .filter((f) => f.startsWith('verify-') && f.endsWith('.ts'))
    .filter((f) => (FILTER ? f.includes(FILTER) : true))
    .sort();

  let passed = 0;
  const failed: string[] = [];
  const skipped: Array<{ name: string; lines: string[] }> = [];
  let totalChecks = 0;

  console.log(`Running ${files.length} verifiers ${haveEnv && !ALLOW_OFFLINE ? 'WITH' : 'WITHOUT'} credentials.\n`);

  for (const f of files) {
    const args = haveEnv && !ALLOW_OFFLINE
      ? ['tsx', `--env-file=${ENV_FILE}`, `scripts/${f}`]
      : ['tsx', `scripts/${f}`];
    const r = spawnSync('npx', args, { encoding: 'utf8', shell: true });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    const tally = TALLY.exec(out);
    if (tally) totalChecks += Number(tally[1]) + Number(tally[2]);

    const skipLines = out.split('\n').map((l) => l.trim())
      .filter((l) => SKIP_MARKER.test(l) && !ZERO_SKIPPED.test(l));
    if (skipLines.length) skipped.push({ name: f, lines: [...new Set(skipLines)].slice(0, 4) });

    if (r.status === 0) { passed++; process.stdout.write('.'); }
    else { failed.push(f); process.stdout.write('F'); }
  }

  console.log(`\n\n${'='.repeat(72)}`);
  console.log(`SUITE: ${passed} pass / ${failed.length} fail  (of ${files.length}), ${totalChecks} individual checks`);

  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f}`);
  }

  // A SKIP IS NOT A PASS. This section is the whole point of the runner.
  const unexpected = skipped.filter((s) => !ACCEPTED_SKIPS[s.name]);
  const accepted = skipped.filter((s) => ACCEPTED_SKIPS[s.name]);

  if (accepted.length) {
    console.log(`\nSkipped, known and accepted (${accepted.length}):`);
    for (const s of accepted) console.log(`  - ${s.name}: ${ACCEPTED_SKIPS[s.name]}`);
  }

  if (unexpected.length) {
    console.log(`\nLIVE CHECKS SKIPPED UNEXPECTEDLY in ${unexpected.length} verifier(s). These did NOT run:`);
    for (const s of unexpected) {
      console.log(`  - ${s.name}`);
      for (const l of s.lines) console.log(`      ${l.slice(0, 120)}`);
    }
    console.log('\n  A skipped live check is a coverage hole, not a pass. The admin user list');
    console.log('  outage of 2026-09-02 sat behind exactly one of these for a full session:');
    console.log('  the verifier that ran the exact broken query printed SKIP and passed.');
    console.log('  Either give it what it needs to run, or add it to ACCEPTED_SKIPS with a reason.');
  }

  if (ALLOW_OFFLINE) {
    console.log('\nRESULT IS PARTIAL: run without --allow-offline before quoting this number.');
  }

  const ok = failed.length === 0 && unexpected.length === 0 && !ALLOW_OFFLINE;
  // The summary line STATES the accepted skips rather than saying "no skips",
  // which would be the same comfortable half-truth the runner exists to end.
  const skipNote = accepted.length ? ` (${accepted.length} accepted skip(s), listed above)` : ', no skips';
  console.log(`\n${ok ? `ALL PASS${skipNote}.` : 'NOT CLEAN.'}`);
  process.exit(ok ? 0 : 1);
}

main();
