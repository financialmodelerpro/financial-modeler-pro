/**
 * apply-migration-245.ts
 *
 * Applies 245_project_changes_label_and_save_id.sql, and proves it first.
 *
 * What is proved, by DOING it rather than by reading the DDL back:
 *   - the two columns exist and accept a value;
 *   - a row with BOTH LEFT NULL still inserts, which is what every pre-245
 *     writer does and must keep doing while the code rolls out;
 *   - rows sharing a save_id read back grouped, which is the whole point of
 *     the column;
 *   - THE APPEND-ONLY TRIGGER STILL REFUSES AN UPDATE. A migration that
 *     quietly disarmed the guard would be far worse than one that failed, so
 *     the thing that must fail is attempted.
 *
 * Run: npx tsx scripts/apply-migration-245.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-245.ts --apply  (commits)
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

const APPLY = process.argv.includes('--apply');
const SQL = readFileSync('supabase/migrations/245_project_changes_label_and_save_id.sql', 'utf8');

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
  console.log(`=== migration 245 (${APPLY ? 'APPLY' : 'DRY RUN, rolls back'}) ===\n`);
  try {
    await c.query('begin');
    await c.query(SQL);
    console.log('-- DDL ran --');

    const cols = await c.query(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'refm_project_changes'
          and column_name in ('label','save_id') order by column_name`,
    );
    check('both columns exist', cols.rows.length === 2, JSON.stringify(cols.rows));
    check('both are NULLABLE (pre-245 writers keep working)',
      cols.rows.every((r) => r.is_nullable === 'YES'), JSON.stringify(cols.rows));

    // A real project to hang the probe rows on, so the FK is genuinely tested.
    const proj = await c.query('select id from public.refm_projects limit 1');
    if (proj.rows.length === 0) {
      check('a project exists to probe against', false, 'no rows in refm_projects');
    } else {
      const pid = proj.rows[0].id as string;
      const save = await c.query('select gen_random_uuid() as id');
      const sid = save.rows[0].id as string;

      await c.query(
        `insert into public.refm_project_changes (project_id, action, path, label, save_id)
         values ($1,'update','assets[id=a].buaSqm','Marina Tower: floor area',$2),
                ($1,'update','assets[id=a].landAreaSqm','Marina Tower: land',$2)`,
        [pid, sid],
      );
      const grouped = await c.query(
        'select count(*)::int n from public.refm_project_changes where save_id = $1', [sid],
      );
      check('rows sharing a save_id read back grouped', grouped.rows[0].n === 2, JSON.stringify(grouped.rows[0]));

      // Pinned to a specific row: an unordered `limit 1` over two probe rows
      // picks either one, which is how this read as a failure on the first run.
      const withLabel = await c.query(
        "select label from public.refm_project_changes where save_id = $1 and path like '%buaSqm'",
        [sid],
      );
      check('the label round-trips',
        withLabel.rows.length === 1 && withLabel.rows[0].label === 'Marina Tower: floor area',
        JSON.stringify(withLabel.rows));

      // The pre-245 writer: no label, no save_id. Must still insert.
      const bare = await c.query(
        `insert into public.refm_project_changes (project_id, action, path)
         values ($1,'update','project.name') returning id, label, save_id`,
        [pid],
      );
      check('a row with NEITHER column still inserts (the old writer)',
        bare.rows.length === 1 && bare.rows[0].label === null && bare.rows[0].save_id === null);

      // EVERY EXPECTED-TO-FAIL STATEMENT GETS A SAVEPOINT. A raised exception
      // aborts the whole transaction in Postgres, so without one the FIRST
      // refusal poisons every check after it and they read as failures that are
      // not real (TRAPS 3.21: the same trap, from the other side).
      const expectRefusal = async (sql: string, params: unknown[]): Promise<boolean> => {
        await c.query('savepoint probe');
        try { await c.query(sql, params); await c.query('release savepoint probe'); return false; }
        catch { await c.query('rollback to savepoint probe'); return true; }
      };

      // THE GUARD THAT MUST STILL BITE.
      check('THE APPEND-ONLY TRIGGER STILL REFUSES AN UPDATE to a logged row',
        await expectRefusal('update public.refm_project_changes set label = $1 where save_id = $2', ['tampered', sid]));

      // The guard is now LIST-FREE, so a column it was never told about is
      // guarded too. Proved on save_id, which 234 could not have known of.
      check('and refuses an update to a column added AFTER the guard was written',
        await expectRefusal('update public.refm_project_changes set save_id = gen_random_uuid() where save_id = $1', [sid]));

      // The one permitted update must still work, or the cascade breaks.
      let setNullOk = true;
      try {
        await c.query('update public.refm_project_changes set version_id = null where save_id = $1', [sid]);
      } catch { setNullOk = false; }
      check('but still PERMITS an FK being released to NULL (the cascade depends on it)', setNullOk);
    }

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
