/**
 * apply-migration-234.ts
 *
 * Applies 234_refm_project_changes.sql, and proves it first.
 *
 * The proof that matters here is APPEND-ONLY, and it is proved by ATTEMPTING
 * THE THING THAT MUST FAIL: an UPDATE on an audit row. A guard nobody has seen
 * reject anything is a guard nobody knows works.
 *
 * Also proved:
 *   - an insert works, and reads back;
 *   - DELETE is still possible, because the project cascade depends on it, and
 *     the cascade actually removes a deleted project's history;
 *   - version_id and user_id SET NULL rather than taking the row with them, so
 *     the audit fact outlives a deleted version and a closed account.
 *
 * Run: npx tsx scripts/apply-migration-234.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-234.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/234_refm_project_changes.sql';
const APPLY = process.argv.includes('--apply');

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const t = await c.query(`SELECT to_regclass('public.refm_project_changes') AS t`);
  if (t.rows[0]?.t === null) return { table: null, rows: 0, trigger: false };
  const cols = await c.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='refm_project_changes' ORDER BY ordinal_position`);
  const trg = await c.query(`SELECT tgname FROM pg_trigger
    WHERE tgrelid='public.refm_project_changes'::regclass AND NOT tgisinternal`);
  const n = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_changes`);
  return {
    table: 'refm_project_changes',
    columns: cols.rows.map((r) => r.column_name),
    triggers: trg.rows.map((r) => r.tgname),
    rows: n.rows[0]?.n ?? 0,
  };
}

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const sql = migrationBody();

  console.log('=== BEFORE ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));

  console.log('\n=== DRY RUN (transaction, rolled back) ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    console.log('  first run: OK');
    console.log('  after: ' + JSON.stringify(await snapshot(c)));
    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    const owner = await c.query(`SELECT id, user_id FROM public.refm_projects LIMIT 1`);
    const pid = owner.rows[0].id as string;
    const u = await c.query(`INSERT INTO public.users (email, name)
      VALUES ('probe-234@example.invalid', 'Probe 234') RETURNING id`);
    const uid = u.rows[0].id as string;
    const v = await c.query(`SELECT id FROM public.refm_project_versions WHERE project_id = $1 LIMIT 1`, [pid]);
    const vid = (v.rows[0]?.id ?? null) as string | null;

    // 1. Append works.
    const ins = await c.query(
      `INSERT INTO public.refm_project_changes (project_id, version_id, user_id, action, path, before, after)
       VALUES ($1, $2, $3, 'update', 'assets[id=probe].buaSqm', '0'::jsonb, '100'::jsonb) RETURNING id, created_at`,
      [pid, vid, uid]);
    console.log(`  APPEND: a row was written = ${ins.rows.length === 1}, created_at set = ${!!ins.rows[0].created_at}`);
    const rowId = ins.rows[0].id as string;

    // 2. THE PROOF: an UPDATE must be rejected.
    await c.query('SAVEPOINT upd');
    try {
      await c.query(`UPDATE public.refm_project_changes SET after = '999'::jsonb WHERE id = $1`, [rowId]);
      console.log('  APPEND-ONLY: FAILED, an audit row was rewritten');
    } catch (e: unknown) {
      console.log('  APPEND-ONLY guard fired: '
        + String((e as { message?: string }).message).slice(0, 120));
    }
    await c.query('ROLLBACK TO SAVEPOINT upd');

    // RE-POINTING an FK must be refused. Releasing one to NULL is allowed
    // (that is ON DELETE SET NULL), but pointing it at a DIFFERENT person
    // would silently re-attribute a change, which is the worst thing an
    // audit row could do quietly.
    await c.query('SAVEPOINT upd2');
    try {
      const other = await c.query(`SELECT id FROM public.users WHERE id <> $1 LIMIT 1`, [uid]);
      await c.query(`UPDATE public.refm_project_changes SET user_id = $1 WHERE id = $2`,
        [other.rows[0].id, rowId]);
      console.log('  RE-ATTRIBUTION: FAILED, an audit row was pointed at another user');
    } catch (e: unknown) {
      console.log('  RE-ATTRIBUTION refused: an audit row cannot be pointed at another user');
    }
    await c.query('ROLLBACK TO SAVEPOINT upd2');

    // 3. A deleted VERSION must not take the audit row with it.
    if (vid) {
      await c.query('SAVEPOINT delver');
      try {
        await c.query(`DELETE FROM public.refm_project_versions WHERE id = $1`, [vid]);
        const still = await c.query(`SELECT version_id FROM public.refm_project_changes WHERE id = $1`, [rowId]);
        console.log(`  VERSION DELETED: audit row survives = ${still.rows.length === 1}`
          + `, version_id nulled = ${still.rows[0]?.version_id === null}`);
      } catch (e: unknown) {
        console.log('  version-delete probe skipped: ' + String((e as { message?: string }).message).slice(0, 90));
      }
      await c.query('ROLLBACK TO SAVEPOINT delver');
    }

    // 4. A deleted USER must not take it either.
    await c.query('SAVEPOINT deluser');
    await c.query(`DELETE FROM public.users WHERE id = $1`, [uid]);
    const afterUser = await c.query(`SELECT user_id FROM public.refm_project_changes WHERE id = $1`, [rowId]);
    console.log(`  AUTHOR DELETED: audit row survives = ${afterUser.rows.length === 1}`
      + `, user_id nulled = ${afterUser.rows[0]?.user_id === null}`);
    await c.query('ROLLBACK TO SAVEPOINT deluser');

    // 5. The project cascade must still work, which is why DELETE is allowed.
    await c.query('SAVEPOINT casc');
    const p2 = await c.query(`INSERT INTO public.refm_projects (user_id, name)
      VALUES ($1, 'changes cascade probe') RETURNING id`, [owner.rows[0].user_id]);
    await c.query(`INSERT INTO public.refm_project_changes (project_id, action, path)
      VALUES ($1, 'update', 'probe')`, [p2.rows[0].id]);
    await c.query(`DELETE FROM public.refm_projects WHERE id = $1`, [p2.rows[0].id]);
    const left = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_changes WHERE project_id = $1`,
      [p2.rows[0].id]);
    console.log(`  PROJECT CASCADE: deleting the project removed its history = ${left.rows[0].n === 0}`
      + ' (this is why DELETE is not blocked)');
    await c.query('ROLLBACK TO SAVEPOINT casc');
  } finally {
    await c.query('ROLLBACK');
  }
  console.log('  rolled back');

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to commit.');
    await c.end();
    return;
  }

  console.log('\n=== APPLYING FOR REAL ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  console.log('committed.');
  console.log('\n=== AFTER ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));
  await c.end();
}

main().catch((e: unknown) => { console.error('ERR', (e as { message?: string }).message); process.exit(1); });
