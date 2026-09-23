/**
 * apply-migration-246.ts
 *
 * Applies 246_project_last_seen.sql, and proves it first.
 *
 * What is proved, by DOING it:
 *   - a row inserts and reads back;
 *   - the PRIMARY KEY makes a SECOND row for the same person and project
 *     impossible, so "one last-seen per person per project" is enforced by the
 *     shape rather than by the writer remembering to upsert;
 *   - an upsert MOVES the time rather than adding a row, which is the only
 *     write this table ever takes;
 *   - BOTH cascades fire: deleting the project removes the marker, and so does
 *     deleting the person. A marker that outlived either would be a row nobody
 *     can reach and nobody deletes.
 *
 * Every expected-to-fail statement gets a SAVEPOINT, or the first refusal
 * aborts the transaction and every later check reads as a failure that is not
 * real (TRAPS 3.21).
 *
 * Run: npx tsx scripts/apply-migration-246.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-246.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { withProbes, expectRefusal } from './lib/migrationProbe';

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

const APPLY = process.argv.includes('--apply');
const SQL = readFileSync('supabase/migrations/246_project_last_seen.sql', 'utf8');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('FAIL: DATABASE_URL is not set.'); process.exit(1); }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 246 (${APPLY ? 'APPLY' : 'DRY RUN, rolls back'}) ===\n`);
  try {
    await c.query('begin');
    await c.query(SQL);
    console.log('-- DDL ran --');

    // EVERY WRITE BELOW IS A PROOF, NOT DATA, and is rolled back before the
    // commit. The DDL above is outside this block and commits normally.
    await withProbes(c, async () => {

    const cols = await c.query(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'refm_project_last_seen'
        order by column_name`,
    );
    check('the table exists with its three columns', cols.rows.length === 3, JSON.stringify(cols.rows));
    check('every column is NOT NULL (a marker with a missing half means nothing)',
      cols.rows.every((r) => r.is_nullable === 'NO'), JSON.stringify(cols.rows));

    const proj = await c.query('select id, user_id from public.refm_projects limit 1');
    if (proj.rows.length === 0) {
      check('a project exists to probe against', false, 'no rows in refm_projects');
    } else {
      const pid = proj.rows[0].id as string;
      const uid = proj.rows[0].user_id as string;

      await c.query(
        `insert into public.refm_project_last_seen (user_id, project_id, seen_at)
         values ($1, $2, now())`, [uid, pid],
      );
      const one = await c.query(
        'select count(*)::int n from public.refm_project_last_seen where user_id = $1 and project_id = $2',
        [uid, pid],
      );
      check('a marker inserts and reads back', one.rows[0].n === 1);

      // A SECOND row for the same pair must be impossible. `expectRefusal` is
      // the SHARED one (scripts/lib/migrationProbe.ts), carrying its own
      // savepoint per attempt (TRAPS 3.21).
      check('a SECOND marker for the same person and project is impossible',
        await expectRefusal(c,
          `insert into public.refm_project_last_seen (user_id, project_id, seen_at)
           values ($1, $2, now())`, [uid, pid]));

      // The only write this table takes: move the time.
      await c.query(
        `insert into public.refm_project_last_seen (user_id, project_id, seen_at)
         values ($1, $2, now() + interval '1 hour')
         on conflict (user_id, project_id) do update set seen_at = excluded.seen_at`,
        [uid, pid],
      );
      const still = await c.query(
        'select count(*)::int n from public.refm_project_last_seen where user_id = $1 and project_id = $2',
        [uid, pid],
      );
      check('an upsert MOVES the time rather than adding a row', still.rows[0].n === 1);

      // THE CASCADES. Proved inside savepoints so the probe can delete a real
      // project and a real user without either deletion surviving the run.
      await c.query('savepoint cascade_project');
      await c.query('delete from public.refm_projects where id = $1', [pid]);
      const afterProject = await c.query(
        'select count(*)::int n from public.refm_project_last_seen where project_id = $1', [pid],
      );
      check('deleting the PROJECT removes its markers', afterProject.rows[0].n === 0);
      await c.query('rollback to savepoint cascade_project');

      await c.query('savepoint cascade_user');
      let userCascadeOk = false;
      try {
        await c.query('delete from public.users where id = $1', [uid]);
        const afterUser = await c.query(
          'select count(*)::int n from public.refm_project_last_seen where user_id = $1', [uid],
        );
        userCascadeOk = afterUser.rows[0].n === 0;
      } catch (e) {
        // A user with other blocking references cannot be deleted here, which
        // is not this migration's business. Reported rather than passed.
        console.log(`    (user delete blocked by another constraint: ${(e as { message?: string }).message})`);
      }
      await c.query('rollback to savepoint cascade_user');
      check('deleting the PERSON removes their markers', userCascadeOk);
    }
    }); // withProbes: every probe write above is undone here, always

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    if (fail > 0) {
      await c.query('rollback');
      console.log('ROLLED BACK: a check failed, so nothing was applied.');
      process.exit(1);
    }
    if (APPLY) { await c.query('commit'); console.log('COMMITTED.'); }
    else { await c.query('rollback'); console.log('ROLLED BACK (dry run). Re-run with --apply to commit.'); }
  } catch (e) {
    try { await c.query('rollback'); } catch { /* already gone */ }
    console.error('FAILED, rolled back:', (e as { message?: string }).message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
