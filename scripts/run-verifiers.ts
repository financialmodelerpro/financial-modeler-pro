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
 *   npx tsx scripts/run-verifiers.ts --batch 2/4     (the second quarter of the sorted list)
 *   npx tsx scripts/run-verifiers.ts --summarise <log> [<log> ...]
 *                                                    (one count from several batch logs)
 *   --timeout-min N   per-verifier limit (default 40); a verifier over it FAILS as TIMEOUT
 *   --allow-sleep     do not hold the machine awake (it is held awake on Windows by default)
 *
 * THE LOG (2026-10-06, founder): every verifier's name, PASS / FAIL / TIMEOUT,
 * check count and duration is APPENDED to .suite-logs/<run>/suite.log the
 * moment it finishes (appendFileSync, so a killed run is still readable), with
 * its [FAIL] lines beneath, and its whole output goes to <name>.out beside it.
 * A run that printed only dots could not name what broke, and a stalled one
 * told us nothing; every regression of that week was found by this suite alone.
 *
 * No em dashes in this file.
 */
import { readdirSync, existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

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
  'verify-formula-workbook.ts':
    'Its real-Excel half (recalculate the formula-linked export in Excel and compare every '
    + 'figure with the platform) needs Excel, so it skips where Excel is not installed; the '
    + 'offline half always runs. On the founder machine, where Excel is installed, it runs in full.',
};
const TALLY = /(\d+) passed, (\d+) failed/;

const batchIdx = process.argv.indexOf('--batch');
const BATCH = batchIdx >= 0 ? process.argv[batchIdx + 1] ?? '' : '';
const timeoutIdx = process.argv.indexOf('--timeout-min');
const TIMEOUT_MS = (timeoutIdx >= 0 ? Number(process.argv[timeoutIdx + 1]) : 40) * 60_000;

/** One verifier's line in the log. The summariser parses exactly this shape. */
const LOG_LINE = /^\S+ (PASS|FAIL|TIMEOUT) (verify-[\w.-]+\.ts) checks (\d+) \((\d+) passed, (\d+) failed\) ([\d.]+)s$/;

function allVerifiers(): string[] {
  return readdirSync('scripts').filter((f) => f.startsWith('verify-') && f.endsWith('.ts')).sort();
}

/**
 * KEEP THE MACHINE AWAKE FOR THE RUN (2026-10-07, founder). Three suite runs in
 * three days "hung" because the machine went to sleep under them (Kernel-Power
 * 506 / 42 in the System log: lid, idle timeout, standby battery budget), and a
 * sleeping machine fires no timer, so even the per-verifier timeout waited.
 * On Windows a PowerShell child holds SetThreadExecutionState(ES_CONTINUOUS |
 * ES_SYSTEM_REQUIRED) while this runner's process exists (it polls the parent
 * PID and exits with it, so a killed runner leaves nothing behind); `powercfg
 * /requests` lists it under SYSTEM while a run is on. It blocks IDLE sleep only:
 * closing the lid still sleeps the machine unless the lid action is "do nothing".
 */
function keepAwake(): () => void {
  if (process.platform !== 'win32' || process.argv.includes('--allow-sleep')) return () => {};
  const ps = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [void][W.P]::SetThreadExecutionState([uint32]2147483649); while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }`;
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  return () => { try { child.kill(); } catch { /* already gone */ } };
}

/** Runs one verifier, killing its whole process tree if it passes the limit. */
function runOne(args: string[]): Promise<{ status: 'PASS' | 'FAIL' | 'TIMEOUT'; out: string; secs: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn('npx', args, { shell: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // shell: true puts npx, tsx and node under a shell; on Windows only a tree kill stops them all.
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)]);
      else child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL', out, secs: (Date.now() - t0) / 1000 });
    });
  });
}

/** One count from one or more logs: the LAST result per verifier wins, and anything missing is named. */
function summarise(logs: string[]): void {
  const latest = new Map<string, { status: string; checks: number; log: string; head: string }>();
  for (const log of logs) {
    const text = readFileSync(log, 'utf8');
    const head = text.split(/\r?\n/)[0] ?? '';
    for (const line of text.split(/\r?\n/)) {
      const m = LOG_LINE.exec(line);
      if (m) latest.set(m[2], { status: m[1], checks: Number(m[3]), log, head });
    }
  }
  const all = allVerifiers();
  const missing = all.filter((f) => !latest.has(f));
  const failed = [...latest].filter(([, r]) => r.status !== 'PASS');
  const checks = [...latest.values()].reduce((a, r) => a + r.checks, 0);
  const heads = [...new Set([...latest.values()].map((r) => r.head))];
  for (const h of heads) console.log(h);
  console.log(`SUITE (from ${logs.length} log(s)): ${latest.size - failed.length} pass / ${failed.length} fail  (of ${latest.size} run, ${all.length} in the suite), ${checks} individual checks`);
  for (const [f, r] of failed) console.log(`  ${r.status} ${f}  (${r.log})`);
  if (missing.length) {
    console.log(`\nNOT RUN (${missing.length}): this is NOT the suite count until they are.`);
    for (const f of missing) console.log(`  - ${f}`);
  }
  const ok = missing.length === 0 && failed.length === 0;
  console.log(`\n${ok ? 'ALL PASS.' : 'NOT CLEAN.'}`);
  process.exit(ok ? 0 : 1);
}

async function main(): Promise<void> {
  const sumIdx = process.argv.indexOf('--summarise');
  if (sumIdx >= 0) return summarise(process.argv.slice(sumIdx + 1).filter((a) => !a.startsWith('--')));

  if (!haveEnv && !ALLOW_OFFLINE) {
    console.error(`\nREFUSING TO RUN: ${ENV_FILE} is missing.`);
    console.error('Fourteen verifiers have a live half that silently skips without credentials,');
    console.error('and a suite that skips its live checks reports a number it has not earned.');
    console.error('Run with --allow-offline to measure the static half only, knowing it is partial.\n');
    process.exit(2);
  }

  let files = allVerifiers().filter((f) => (FILTER ? f.includes(FILTER) : true));
  if (BATCH) {
    const [k, n] = BATCH.split('/').map(Number);
    const size = Math.ceil(files.length / n);
    files = files.slice((k - 1) * size, k * size);
  }
  const runDir = `.suite-logs/${new Date().toISOString().replace(/[:.]/g, '-')}${BATCH ? `_batch-${BATCH.replace('/', 'of')}` : ''}`;
  mkdirSync(runDir, { recursive: true });
  const LOG = `${runDir}/suite.log`;
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim() !== '';
  const creds = haveEnv && !ALLOW_OFFLINE ? 'WITH' : 'WITHOUT';
  writeFileSync(LOG, `# suite run at ${commit}${dirty ? ' (TREE NOT CLEAN: do not quote this count)' : ''}, ${files.length} verifiers, ${creds} credentials${BATCH ? `, batch ${BATCH}` : ''}\n`);

  let passed = 0;
  const failed: string[] = [];
  const skipped: Array<{ name: string; lines: string[] }> = [];
  let totalChecks = 0;

  console.log(`Running ${files.length} verifiers ${creds} credentials at ${commit}${dirty ? ' (TREE NOT CLEAN)' : ''}. Log: ${LOG}\n`);
  const releaseAwake = keepAwake();

  for (const f of files) {
    const args = haveEnv && !ALLOW_OFFLINE
      ? ['tsx', `--env-file=${ENV_FILE}`, `scripts/${f}`]
      : ['tsx', `scripts/${f}`];
    const r = await runOne(args);
    const out = r.out;
    writeFileSync(`${runDir}/${f.replace(/\.ts$/, '')}.out`, out);

    const tally = TALLY.exec(out);
    if (tally) totalChecks += Number(tally[1]) + Number(tally[2]);
    const p = tally ? Number(tally[1]) : 0, q = tally ? Number(tally[2]) : 0;
    const fails = out.split(/\r?\n/).filter((l) => /^\s*\[FAIL\]/.test(l)).slice(0, 8).map((l) => `    ${l.trim().slice(0, 300)}`);
    // Flushed per verifier, so a killed or stalled run still names everything it finished.
    appendFileSync(LOG, `${new Date().toISOString()} ${r.status} ${f} checks ${p + q} (${p} passed, ${q} failed) ${r.secs.toFixed(1)}s\n${fails.length ? `${fails.join('\n')}\n` : ''}`);

    const skipLines = out.split('\n').map((l) => l.trim())
      .filter((l) => SKIP_MARKER.test(l) && !ZERO_SKIPPED.test(l));
    if (skipLines.length) skipped.push({ name: f, lines: [...new Set(skipLines)].slice(0, 4) });

    if (r.status === 'PASS') passed++;
    else failed.push(r.status === 'TIMEOUT' ? `${f} (TIMEOUT after ${TIMEOUT_MS / 60_000} min)` : f);
    console.log(`  ${r.status.padEnd(7)} ${f.padEnd(48)} ${String(p + q).padStart(5)} checks ${r.secs.toFixed(1).padStart(7)}s`);
  }

  console.log(`\n\n${'='.repeat(72)}`);
  console.log(`SUITE${BATCH ? ` BATCH ${BATCH}` : ""}: ${passed} pass / ${failed.length} fail  (of ${files.length}), ${totalChecks} individual checks at ${commit}${dirty ? " (TREE NOT CLEAN)" : ""}`);
  console.log(`Log: ${LOG}`);

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
  releaseAwake();
  process.exit(ok ? 0 : 1);
}

void main();
