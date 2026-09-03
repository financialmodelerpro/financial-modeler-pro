/**
 * apply-migration-236.ts
 *
 * Applies 236_refm_project_comments.sql, and proves it first.
 *
 * Every claim the migration makes is tested by CAUSING the situation, not by
 * reading the DDL back:
 *
 *   1. A root comment inserts and reads back.
 *   2. A REPLY inserts against that root.
 *   3. A REPLY TO A REPLY IS REFUSED. This is the rule that cannot be added
 *      later, so it is the one that has to be seen rejecting something.
 *   4. A comment with NO version and NO path is valid: a comment on the
 *      project as a whole is the common case, not an edge case.
 *   5. Deleting the VERSION leaves the comment standing with version_id NULL.
 *   6. Deleting the AUTHOR leaves the comment standing with user_id NULL.
 *   7. An empty or whitespace-only body is refused by the CHECK.
 *   8. Deleting the PROJECT takes its comments with it.
 *   9. Idempotent: the body runs twice and the second run changes nothing.
 *
 * Everything runs inside ONE transaction against throwaway rows, and the
 * probes destroy their own fixtures, so the table is left empty either way.
 *
 * Run: npx tsx scripts/apply-migration-236.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-236.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/236_refm_project_comments.sql';
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

/** Run something that MUST fail, and report whether it did. */
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
  console.log(`=== migration 236 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const t = await c.query(`SELECT to_regclass('public.refm_project_comments') AS t`);
    check('0 the table exists after the body runs', t.rows[0]?.t !== null);

    // A throwaway user -> project -> version chain, entirely our own.
    // TWO users, and the split is forced by the schema: refm_projects.user_id
    // is NOT NULL, so the project's owner cannot be deleted while the project
    // stands. The AUTHOR is a different person, which is also the realistic
    // case: the one who leaves is rarely the one who owns the project.
    const stamp = Date.now();
    const u = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe236-owner+${stamp}@example.invalid`, 'Probe 236 owner']);
    const userId = String(u.rows[0].id);
    const a = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe236-author+${stamp}@example.invalid`, 'Probe 236 author']);
    const authorId = String(a.rows[0].id);
    const p = await c.query(
      `INSERT INTO refm_projects (user_id, name, schema_version) VALUES ($1, $2, 7) RETURNING id`,
      [userId, 'ZZ probe 236']);
    const projectId = String(p.rows[0].id);
    const v = await c.query(
      `INSERT INTO refm_project_versions (project_id, version_number, schema_version, snapshot)
       VALUES ($1, 1, 7, '{}'::jsonb) RETURNING id`, [projectId]);
    const versionId = String(v.rows[0].id);

    const root = await c.query(
      `INSERT INTO refm_project_comments (project_id, version_id, user_id, path, body)
       VALUES ($1, $2, $3, 'assets[id=probe].buaSqm', 'The BUA looks high.') RETURNING id, created_at`,
      [projectId, versionId, authorId]);
    const rootId = String(root.rows[0].id);
    check('1 a root comment inserts and reads back', !!rootId && !!root.rows[0].created_at);

    const reply = await c.query(
      `INSERT INTO refm_project_comments (project_id, user_id, parent_id, body)
       VALUES ($1, $2, $3, 'Agreed, it is the gross figure.') RETURNING id`,
      [projectId, authorId, rootId]);
    const replyId = String(reply.rows[0].id);
    check('2 a reply to a root inserts', !!replyId);

    const nested = await refuses(c,
      `INSERT INTO refm_project_comments (project_id, user_id, parent_id, body)
       VALUES ($1, $2, $3, 'And a third level.')`,
      [projectId, authorId, replyId], /replies are ONE level/);
    check('3 a reply to a REPLY is refused by the database', nested.ok, nested.msg);

    const selfReply = await refuses(c,
      `UPDATE refm_project_comments SET parent_id = id WHERE id = $1`,
      [rootId], /cannot reply to itself/);
    check('3b a comment cannot be made to reply to itself', selfReply.ok, selfReply.msg);

    const bare = await c.query(
      `INSERT INTO refm_project_comments (project_id, user_id, body)
       VALUES ($1, $2, 'General note on the whole project.') RETURNING id, version_id, path`,
      [projectId, authorId]);
    check('4 a comment with NO version and NO path is valid',
      bare.rows[0].version_id === null && bare.rows[0].path === null);

    const blank = await refuses(c,
      `INSERT INTO refm_project_comments (project_id, user_id, body) VALUES ($1, $2, '   ')`,
      [projectId, userId], /check constraint/i);
    check('7 a whitespace-only body is refused', blank.ok, blank.msg);

    await c.query(`DELETE FROM refm_project_versions WHERE id = $1`, [versionId]);
    const afterVer = await c.query(
      `SELECT id, version_id, body FROM refm_project_comments WHERE id = $1`, [rootId]);
    check('5 deleting the version leaves the comment standing with version_id NULL',
      afterVer.rows.length === 1 && afterVer.rows[0].version_id === null && !!afterVer.rows[0].body);

    // Delete the AUTHOR. The project keeps its owner, so this isolates the
    // comment's own FK: nothing else is holding the row up.
    await c.query(`DELETE FROM refm_project_members WHERE user_id = $1`, [authorId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [authorId]);
    const afterUser = await c.query(
      `SELECT id, user_id, body FROM refm_project_comments WHERE id = $1`, [rootId]);
    check('6 deleting the author leaves the comment standing with user_id NULL',
      afterUser.rows.length === 1 && afterUser.rows[0].user_id === null && !!afterUser.rows[0].body);

    const before = await c.query(`SELECT count(*)::int AS n FROM refm_project_comments WHERE project_id = $1`, [projectId]);
    await c.query(`DELETE FROM refm_projects WHERE id = $1`, [projectId]);
    const after = await c.query(`SELECT count(*)::int AS n FROM refm_project_comments WHERE project_id = $1`, [projectId]);
    check('8 deleting the project takes its comments with it',
      Number(before.rows[0].n) >= 3 && Number(after.rows[0].n) === 0,
      `before=${before.rows[0].n} after=${after.rows[0].n}`);

    await c.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await c.query(migrationBody());
    const t2 = await c.query(`SELECT to_regclass('public.refm_project_comments') AS t`);
    const trg = await c.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid='public.refm_project_comments'::regclass AND NOT tgisinternal`);
    check('9 idempotent: re-running leaves the table and its one trigger in place',
      t2.rows[0]?.t !== null && trg.rows.length === 1, trg.rows.map((r) => String(r.tgname)).join(','));

    const left = await c.query(`SELECT count(*)::int AS n FROM refm_project_comments`);
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
