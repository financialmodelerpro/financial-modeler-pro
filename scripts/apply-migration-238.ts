/**
 * apply-migration-238.ts
 *
 * Applies 238_project_delete_requests.sql, and proves it first.
 *
 * Every claim is tested by CAUSING the situation:
 *   1. A request inserts and reads back as pending.
 *   2. A SECOND pending request on the same project is REFUSED (the partial
 *      unique index), so two editors cannot queue two deletes for one thing.
 *   3. A pending request on a DIFFERENT project is fine.
 *   4. Deciding the first frees the index: a new request can then be raised.
 *   5. The decline fields SURVIVE a later approval, both halves readable.
 *   6. Deleting the REQUESTER leaves the request standing with requested_by
 *      NULL: the fact outlives the account.
 *   7. HARD deleting the project removes its requests, via the trigger.
 *   8. THE CASCADE ALSO FIRES THROUGH THE USERS CASCADE, which is the case
 *      application code cannot see: deleting the owning user deletes the
 *      project inside Postgres, and the request must go with it.
 *   9. Idempotent.
 *
 * Run: npx tsx scripts/apply-migration-238.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-238.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';

interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[]; rowCount: number | null }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const SQL_PATH = 'supabase/migrations/238_project_delete_requests.sql';
const APPLY = process.argv.includes('--apply');

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

async function refuses(c: PgClient, sql: string, values: unknown[], want: RegExp): Promise<{ ok: boolean; msg: string }> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, values);
    await c.query('ROLLBACK TO SAVEPOINT probe');
    return { ok: false, msg: 'the statement SUCCEEDED and should not have' };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe');
    const msg = (e as { message?: string }).message ?? '';
    return { ok: want.test(msg), msg };
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 238 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const t = await c.query(`SELECT to_regclass('public.project_delete_requests') AS t`);
    check('0 the table exists after the body runs', t.rows[0]?.t !== null);

    const stamp = Date.now();
    const u = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Probe 238 owner', 'user') RETURNING id`,
      [`probe238-owner+${stamp}@example.invalid`]);
    const ownerId = String(u.rows[0].id);
    const e = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Probe 238 editor', 'user') RETURNING id`,
      [`probe238-editor+${stamp}@example.invalid`]);
    const editorId = String(e.rows[0].id);
    const mk = async (name: string) => String((await c.query(
      `INSERT INTO refm_projects (user_id, name, schema_version) VALUES ($1, $2, 7) RETURNING id`,
      [ownerId, name])).rows[0].id);
    const projectA = await mk('ZZ probe 238 A');
    const projectB = await mk('ZZ probe 238 B');

    const r1 = await c.query(
      `INSERT INTO project_delete_requests (platform, project_id, requested_by)
       VALUES ('refm', $1, $2) RETURNING id, status, created_at`, [projectA, editorId]);
    check('1 a request inserts and reads back as pending',
      String(r1.rows[0].status) === 'pending' && !!r1.rows[0].created_at);
    const reqId = String(r1.rows[0].id);

    const dup = await refuses(c,
      `INSERT INTO project_delete_requests (platform, project_id, requested_by) VALUES ('refm', $1, $2)`,
      [projectA, ownerId], /project_delete_requests_one_pending|duplicate key/i);
    check('2 a SECOND pending request on the same project is refused', dup.ok, dup.msg);

    const other = await c.query(
      `INSERT INTO project_delete_requests (platform, project_id, requested_by)
       VALUES ('refm', $1, $2) RETURNING id`, [projectB, editorId]);
    check('3 a pending request on a DIFFERENT project is allowed', !!other.rows[0].id);

    // Decline the first, then approve it: both halves must survive.
    await c.query(
      `UPDATE project_delete_requests
          SET status='declined', decided_at=clock_timestamp(), decided_by=$2,
              declined_at=clock_timestamp(), declined_by=$2, decline_reason='not yet'
        WHERE id=$1`, [reqId, ownerId]);
    const afterDecline = await c.query(`SELECT status, declined_at, decline_reason FROM project_delete_requests WHERE id=$1`, [reqId]);
    check('4 deciding it frees the partial index (a new request can be raised)',
      String(afterDecline.rows[0].status) === 'declined');
    const again = await c.query(
      `INSERT INTO project_delete_requests (platform, project_id, requested_by)
       VALUES ('refm', $1, $2) RETURNING id`, [projectA, editorId]);
    check('4b a fresh request on that project now inserts', !!again.rows[0].id);

    await c.query(
      `UPDATE project_delete_requests SET status='approved', decided_at=clock_timestamp(), decided_by=$2 WHERE id=$1`,
      [reqId, ownerId]);
    const both = await c.query(
      `SELECT status, declined_at, declined_by, decline_reason, decided_at FROM project_delete_requests WHERE id=$1`, [reqId]);
    check('5 the decline SURVIVES a later approval, both halves readable',
      String(both.rows[0].status) === 'approved'
      && both.rows[0].declined_at !== null
      && both.rows[0].decline_reason === 'not yet'
      && both.rows[0].decided_at !== null);

    // 6. The requester's account closes; the request stands.
    await c.query(`DELETE FROM refm_project_members WHERE user_id = $1`, [editorId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [editorId]);
    const orphan = await c.query(
      `SELECT id, requested_by FROM project_delete_requests WHERE project_id = $1 AND status = 'pending'`, [projectA]);
    check('6 deleting the REQUESTER leaves the request standing, requested_by NULL',
      orphan.rows.length === 1 && orphan.rows[0].requested_by === null);

    // 7. A hard delete of the project takes its requests with it.
    const beforeB = await c.query(`SELECT count(*)::int AS n FROM project_delete_requests WHERE project_id = $1`, [projectB]);
    await c.query(`DELETE FROM refm_projects WHERE id = $1`, [projectB]);
    const afterB = await c.query(`SELECT count(*)::int AS n FROM project_delete_requests WHERE project_id = $1`, [projectB]);
    check('7 hard deleting the project removes its requests (the trigger)',
      Number(beforeB.rows[0].n) >= 1 && Number(afterB.rows[0].n) === 0,
      `before=${beforeB.rows[0].n} after=${afterB.rows[0].n}`);

    // 8. THE CASE APPLICATION CODE CANNOT SEE: the users cascade deletes the
    //    project inside Postgres, so only a trigger can clear the request.
    const beforeA = await c.query(`SELECT count(*)::int AS n FROM project_delete_requests WHERE project_id = $1`, [projectA]);
    await c.query(`DELETE FROM refm_project_members WHERE user_id = $1`, [ownerId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    const projGone = await c.query(`SELECT count(*)::int AS n FROM refm_projects WHERE id = $1`, [projectA]);
    const afterA = await c.query(`SELECT count(*)::int AS n FROM project_delete_requests WHERE project_id = $1`, [projectA]);
    check('8 the USERS cascade also clears requests (no route sees that delete)',
      Number(beforeA.rows[0].n) >= 1 && Number(projGone.rows[0].n) === 0 && Number(afterA.rows[0].n) === 0,
      `requestsBefore=${beforeA.rows[0].n} projectsLeft=${projGone.rows[0].n} requestsAfter=${afterA.rows[0].n}`);

    // 9. Idempotent.
    await c.query(migrationBody());
    const trg = await c.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid='public.refm_projects'::regclass AND NOT tgisinternal AND tgname = 'trg_refm_projects_delete_requests'`);
    check('9 idempotent: the trigger is present exactly once after a re-run', trg.rows.length === 1);

    const left = await c.query(`SELECT count(*)::int AS n FROM project_delete_requests`);
    check('10 no probe rows are left behind', Number(left.rows[0].n) === 0, String(left.rows[0].n));

    if (fail > 0) {
      await c.query('ROLLBACK');
      console.log(`\n=== ${pass} passed, ${fail} FAILED. Rolled back, nothing applied. ===`);
      process.exit(1);
    }
    if (APPLY) {
      await c.query('COMMIT');
      console.log(`\n=== ${pass} passed, 0 failed. COMMITTED. ===`);
    } else {
      await c.query('ROLLBACK');
      console.log(`\n=== ${pass} passed, 0 failed. Rolled back (dry run). Re-run with --apply. ===`);
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* gone */ }
    console.error('FAILED:', (e as Error).message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
