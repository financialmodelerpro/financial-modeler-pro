/**
 * verify-edit-lock.ts
 *
 * Pins Module 10 Collaboration step 5: the edit lock.
 *
 * The rules:
 *   A. The lock is a ROW, one per project, taken only through the atomic SQL
 *      function. Two holders are impossible by construction.
 *   B. THE ACQUIRE IS ONE STATEMENT, and it returns SETOF. A scalar return
 *      yields a row of NULLs on refusal, which reads as a WIN to a caller
 *      counting rows; that bug was real and is pinned so it cannot come back.
 *   C. HEARTBEAT, NOT UNLOAD. Nothing depends on beforeunload. The TTL has one
 *      definition and is passed into the SQL.
 *   D. THE OWNER-ONLY NARROWING IS GONE and an Editor can write. The matrix is
 *      untouched.
 *   E. Which permissions need the lock is DATA, and project management is
 *      deliberately exempt.
 *   F. A lock refusal answers 409 naming the holder, not 404.
 *   G. NOTHING CHANGES FOR A SINGLE-USER ACCOUNT, including on a pre-233
 *      database, where the platform degrades to "no locking" not "no editing".
 *
 * Run: npx tsx scripts/verify-edit-lock.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { roleCan } from '../src/core/collab/projectRoles';
import { roleMayWrite, requiresLock } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';
import { LOCK_TTL_SECONDS, LOCK_HEARTBEAT_SECONDS } from '../src/hubs/modeling/platforms/refm/lib/persistence/lock';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/233_refm_project_locks.sql';
const LOCK = 'src/hubs/modeling/platforms/refm/lib/persistence/lock.ts';
const SRV = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';
const HOOK = 'src/hubs/modeling/platforms/refm/lib/persistence/useEditLock.ts';
const ROUTE = 'app/api/refm/projects/[id]/lock/route.ts';
const BANNER = 'src/hubs/modeling/platforms/refm/components/EditLockBanner.tsx';

console.log('=== A. The lock is a row, one per project ===');
{
  const mig = src(MIG);
  check('A1 the lock table exists', /CREATE TABLE IF NOT EXISTS refm_project_locks/i.test(mig));
  check('A2 project_id is the PRIMARY KEY, so two holders are impossible',
    /project_id\s+uuid\s+PRIMARY KEY/i.test(mig));
  check('A3 it carries holder, acquired, heartbeat and the request pair',
    ['holder_user_id', 'acquired_at', 'heartbeat_at', 'release_requested_by', 'release_requested_at']
      .every((c) => new RegExp(c).test(mig)));
  check('A4 deleting the project removes its lock',
    /project_id[\s\S]{0,80}REFERENCES refm_projects\(id\) ON DELETE CASCADE/i.test(mig));
  check('A5 the applier PROVES the cascade', /CASCADE: deleting the project/.test(src('scripts/apply-migration-233.ts')));
}

console.log('\n=== B. One atomic statement, and it returns SETOF ===');
{
  const mig = src(MIG);
  const fn = mig.split('CREATE FUNCTION refm_acquire_project_lock')[1] ?? '';
  check('B1 the acquire is a single INSERT ... ON CONFLICT DO UPDATE',
    /INSERT INTO refm_project_locks[\s\S]{0,400}ON CONFLICT \(project_id\) DO UPDATE/i.test(fn));
  check('B2 its WHERE decides mine-or-stale inside the statement',
    /WHERE l\.holder_user_id = p_user_id[\s\S]{0,140}OR l\.heartbeat_at </i.test(fn));
  // THE BUG THAT WAS REAL. A scalar return gives a row of NULLs on refusal,
  // which a caller counting rows reads as a win: two people would hold it.
  check('B3 it RETURNS SETOF, so a refusal is zero rows and not a row of nulls',
    /RETURNS SETOF refm_project_locks/i.test(mig)
    && !/RETURNS refm_project_locks\s*\n\s*LANGUAGE/i.test(mig));
  check('B4 the reason SETOF matters is written down where it can be read',
    /SETOF, AND THAT IS NOT A DETAIL/i.test(mig) && /row of nulls|ONE ROW OF/i.test(mig));
  check('B5 the server treats zero rows as REFUSED',
    /rows\.length === 0\) return \{ lock: null/.test(strip(src(LOCK))));
  check('B6 the applier PROVES two waiters never both win, with real connections',
    /TWO WAITERS NEVER BOTH WIN/.test(src('scripts/apply-migration-233.ts'))
    && /Promise\.all\(\[/.test(src('scripts/apply-migration-233.ts')));
  // clock_timestamp, not now(): a heartbeat is a wall-clock fact and now() is
  // frozen for a transaction.
  check('B7 heartbeats use clock_timestamp, not the frozen transaction time',
    /clock_timestamp\(\)/.test(fn) && !/heartbeat_at\s*=\s*now\(\)/.test(fn));
}

console.log('\n=== C. Heartbeat, not unload ===');
{
  const hook = src(HOOK);
  check('C1 there is a heartbeat interval', /setInterval/.test(hook) && /beat\(\)/.test(hook));
  check('C2 the beat interval fits inside the TTL more than twice',
    LOCK_HEARTBEAT_SECONDS * 2 < LOCK_TTL_SECONDS,
    `beat ${LOCK_HEARTBEAT_SECONDS}s, ttl ${LOCK_TTL_SECONDS}s`);
  check('C3 the TTL is defined ONCE and passed into the SQL',
    /p_ttl_seconds: LOCK_TTL_SECONDS/.test(src(LOCK))
    && /p_ttl_seconds integer/.test(src(MIG))
    && !/90/.test((src(MIG).split('CREATE FUNCTION')[1] ?? '')));
  // The unload handler exists but nothing may depend on it.
  check('C4 an unload release is sent as a COURTESY, and said to be one',
    /beforeunload/.test(hook) && /courtesy/i.test(hook));
  // Matched on a phrase that does NOT wrap in either file. The first version
  // looked for "does not fire on a crash", which is split across a line break
  // in the hook comment, so the check failed against a file that says exactly
  // the right thing. Pick evidence that survives reflowing.
  check('C5 the reason unload cannot be relied on is recorded',
    /killed tab/i.test(hook) && /killed tab/i.test(src(MIG)));
  // The beacon can only POST, so the route must read it as a release. Without
  // this it would fall through to acquire and EXTEND the lock on unload.
  check('C6 the unload beacon is handled as a RELEASE, not an acquire',
    /searchParams\.get\('release'\) === '1'/.test(src(ROUTE))
    && /releaseLock/.test(src(ROUTE).split("searchParams.get('release')")[1]?.slice(0, 300) ?? ''));
  check('C7 acquire and heartbeat are the same call, so a stolen lock is noticed',
    /ACQUIRE AND HEARTBEAT ARE THE SAME CALL/i.test(src(ROUTE)));
}

console.log('\n=== D. The owner-only narrowing is gone ===');
{
  check('D1 roleMayWrite no longer narrows anything',
    roleMayWrite('editor') === true && roleMayWrite('viewer') === true && roleMayWrite(null) === true);
  check('D2 it is retired with its history, not deleted silently',
    /RETIRED \(Module 10 step 5\)/.test(src(SRV))
    && /DO NOT REINTRODUCE A ROLE TEST HERE/.test(src(SRV)));
  // THE MATRIX IS UNTOUCHED. An Editor could always save; a Viewer never could.
  check('D3 the matrix is unchanged: Editor saves, Viewer and Reviewer do not',
    roleCan('editor', 'canSave') && roleCan('editor', 'canEditInputs')
    && !roleCan('viewer', 'canSave') && !roleCan('reviewer', 'canSave')
    && !roleCan('editor', 'canDeleteProject'));
  const write = (strip(src(SRV)).split('export async function getProjectForWrite')[1] ?? '').split(/\nexport /)[0];
  check('D4 the write gate no longer consults mayWrite', !/mayWrite/.test(write));
  check('D5 the write gate consults the LOCK instead',
    /requiresLock\(need\)/.test(write) && /holdsLock\(projectId, userId\)/.test(write));
}

console.log('\n=== E. Which writes need the lock is DATA ===');
{
  check('E1 model editing needs the lock',
    requiresLock('canSave') && requiresLock('canEditInputs') && requiresLock('canManageVersions'));
  // Project management is exempt on purpose: an owner must be able to archive
  // their own project while a colleague has it open.
  check('E2 project management does NOT need the lock',
    !requiresLock('canEditProject') && !requiresLock('canDeleteProject'));
  check('E3 export does not need the lock (it writes nothing)', !requiresLock('canExport'));
  check('E4 the exemption is explained, not just coded',
    /PROJECT MANAGEMENT DELIBERATELY DOES NOT/i.test(src(SRV)));
}

console.log('\n=== F. A lock refusal is a 409 naming the holder ===');
{
  for (const f of ['versions/route.ts', 'versions/[versionId]/route.ts']) {
    const text = src(`app/api/refm/projects/[id]/${f}`);
    // Assert the BRANCH, not the vocabulary. The first version tested that
    // the strings appeared anywhere in the file, and disabling the guard
    // left them all in place inside a dead block: the check stayed green
    // while a lock refusal fell through to the 404 it exists to prevent.
    check(`F1 ${f} BRANCHES on the lock refusal and answers 409`,
      /if \(lockedByOther\) \{/.test(text)
      && /status: 409/.test(text) && /LOCKED_BY_OTHER/.test(text));
    check(`F2 ${f} names the holder in the message`,
      /lock\?\.holderName/.test(text));
  }
  check('F3 the gate distinguishes a lock refusal from a role refusal',
    /lockedByOther\?: boolean/.test(src(SRV)));
  check('F4 the acquire endpoint also answers 409, not a bare refusal',
    /status: 409/.test(src(ROUTE)) && /is editing this project/.test(src(ROUTE)));
}

console.log('\n=== G. Nothing changes for a single-user account ===');
{
  const lock = strip(src(LOCK));
  // THE ONE THAT MATTERS. With no lock table there is no lock to hold, and a
  // lone user must keep saving exactly as before.
  const holds = (lock.split('export async function holdsLock')[1] ?? '').split(/\nexport /)[0];
  check('G1 a pre-233 database allows writes (degrade to no locking, not no editing)',
    /if \(tableMissing\) return true/.test(holds));
  check('G2 that reasoning is recorded', /never to "no editing"|degrade to "no locking"/i.test(src(LOCK)));
  check('G3 a stale lock is nobody\'s, so it never blocks',
    /if \(lock\.isStale\) return false/.test(holds));
  // Assert the CALL, not the expression. `editMode && !graceReadOnly` also
  // drives the Topbar prop, so a file-wide match stayed green when
  // useEditLock was pointed at `true`, which is precisely a reader taking a
  // lock simply by opening a project.
  const platform = src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  const lockCall = /useEditLock\(([^)]*)\)/.exec(platform)?.[1] ?? '';
  check('G4 a reader never takes a lock, so opening a project blocks nobody',
    /only while true|ONLY while/i.test(src(HOOK))
    && lockCall.length > 0
    && /editMode/.test(lockCall)
    && !/,\s*true\s*$/.test(lockCall));
  check('G5 the banner renders NOTHING when you hold your own lock uncontended',
    /Holding my own lock with nobody waiting is just editing/.test(src(BANNER)));
  check('G6 the banner renders nothing when locking is unavailable',
    /if \(!lockingAvailable\) return null/.test(src(BANNER)));
  check('G7 releasing scopes to the holder, so nobody frees someone else\'s lock',
    /\.eq\('holder_user_id', userId\)/.test(
      (lock.split('export async function releaseLock')[1] ?? '').split(/\nexport /)[0]));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
