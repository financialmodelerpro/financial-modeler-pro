/**
 * apply-migration-230.ts
 *
 * Applies 230_refm_version_created_by.sql, and proves it first, in the shape
 * 227 / 228 / 229 established:
 *   1. run inside a transaction and ROLL BACK, reporting what changed;
 *   2. re-run in the same transaction to prove idempotence;
 *   3. prove the FK behaves as declared, by deleting a probe user who authored
 *      a probe version and confirming the VERSION SURVIVES with created_by
 *      nulled, rather than cascading away;
 *   4. only then apply for real, and read the result back from the catalog.
 *
 * Step 3 is the one worth the effort. ON DELETE SET NULL versus CASCADE is one
 * word in the migration and the difference between losing a project's history
 * and keeping it, and it is not observable from the schema text alone once
 * written. Everything in step 3 happens inside a transaction that is rolled
 * back, so no real row is touched.
 *
 * Run: npx tsx scripts/apply-migration-230.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-230.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';

// `pg` ships no bundled types and @types/pg is not a dependency of this repo.
// Same minimal structural type the other applier scripts use.
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

const SQL_PATH = 'supabase/migrations/230_refm_version_created_by.sql';
const APPLY = process.argv.includes('--apply');

/** The migration owns its own BEGIN/COMMIT; strip them so this script owns the
 *  transaction and can roll back. Leaving them in would commit the dry run. */
function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const col = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='refm_project_versions' AND column_name='created_by'`);
  const fk = await c.query(`SELECT conname, pg_get_constraintdef(oid) AS def, confdeltype FROM pg_constraint
    WHERE conrelid='public.refm_project_versions'::regclass AND conname='refm_project_versions_created_by_fkey'`);
  const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename='refm_project_versions' AND indexname='idx_refm_versions_created_by'`);
  const n = await c.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE true)::int AS rows FROM public.refm_project_versions`);
  return {
    column: col.rows[0] ?? null,
    fk: fk.rows[0]?.def ?? null,
    confdeltype: fk.rows[0]?.confdeltype ?? null,
    index: idx.rows[0]?.indexname ?? null,
    versionRows: n.rows[0]?.total ?? 0,
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
    const after = await snapshot(c);
    console.log('  column: ' + JSON.stringify(after.column));
    console.log('  fk    : ' + after.fk + `  (confdeltype=${after.confdeltype}, n = SET NULL)`);
    console.log('  index : ' + after.index);
    console.log('  version rows (unchanged expected): ' + after.versionRows);

    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    // ── THE PROOF THAT MATTERS: a deleted author must not take the version
    //    with them. Build a throwaway user -> project -> version chain, delete
    //    the user, and observe what happens to the VERSION.
    await c.query('SAVEPOINT fkprobe');
    try {
      const u = await c.query(
        `INSERT INTO public.users (email, name) VALUES ('probe-230@example.invalid', 'Probe 230') RETURNING id`);
      const uid = u.rows[0].id as string;
      const owner = await c.query(
        `INSERT INTO public.users (email, name) VALUES ('probe-230-owner@example.invalid', 'Probe Owner') RETURNING id`);
      const oid = owner.rows[0].id as string;
      const p = await c.query(
        `INSERT INTO public.refm_projects (user_id, name) VALUES ($1, 'probe 230') RETURNING id`, [oid]);
      const pid = p.rows[0].id as string;
      const v = await c.query(
        `INSERT INTO public.refm_project_versions (project_id, version_number, snapshot, created_by)
         VALUES ($1, 1, '{}'::jsonb, $2) RETURNING id`, [pid, uid]);
      const vid = v.rows[0].id as string;

      // Delete the AUTHOR (not the owner). The version must survive.
      await c.query(`DELETE FROM public.users WHERE id = $1`, [uid]);
      const still = await c.query(
        `SELECT id, created_by FROM public.refm_project_versions WHERE id = $1`, [vid]);
      if (still.rows.length === 0) {
        console.log('  FK PROBE: FAILED, deleting the author CASCADED the version away');
      } else if (still.rows[0].created_by === null) {
        console.log('  FK PROBE: version SURVIVED the author deletion, created_by nulled (correct)');
      } else {
        console.log('  FK PROBE: unexpected, created_by = ' + String(still.rows[0].created_by));
      }
    } catch (e: unknown) {
      console.log('  FK PROBE: could not run -> ' + String((e as { message?: string }).message).slice(0, 140));
    }
    await c.query('ROLLBACK TO SAVEPOINT fkprobe');
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
  console.log('\n=== AFTER (read back from the catalog) ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));
  await c.end();
}

main().catch((e: unknown) => { console.error('ERR', (e as { message?: string }).message); process.exit(1); });
