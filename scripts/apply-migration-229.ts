/**
 * apply-migration-229.ts
 *
 * Applies 229_project_card_status_priority_order.sql, and proves it first.
 *
 * TESTED BEFORE APPLIED, in the shape 227 and 228 established:
 *   1. run inside a transaction and ROLL BACK, reporting what changed;
 *   2. re-run inside the same transaction to prove it is idempotent;
 *   3. prove the guard FIRES, by planting a row the new CHECK cannot express
 *      inside a savepoint and confirming the migration refuses rather than
 *      dropping a constraint live data would violate;
 *   4. only then apply for real, and read the result back from the catalog.
 *
 * Step 3 is the one that matters. A guard nobody has seen fire is a guard
 * nobody knows works, and this one is the only thing standing between a
 * constraint swap and a user's status being silently invalid.
 *
 * Run: npx tsx scripts/apply-migration-229.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-229.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';

// `pg` ships no bundled types and @types/pg is not a dependency of this repo.
// Same minimal structural type `audit-constraints-live.ts` uses: honest about
// the two calls made here, and it adds no package. An `any` would hide a typo
// in a column name, which is the one mistake this script must not make.
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

const SQL_PATH = 'supabase/migrations/229_project_card_status_priority_order.sql';
const APPLY = process.argv.includes('--apply');

// The migration wraps itself in BEGIN/COMMIT. Strip those so this script owns
// the transaction and can roll back; leaving them in would commit the dry run.
function migrationBody(): string {
  const raw = readFileSync(SQL_PATH, 'utf8');
  return raw.replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const cols = await c.query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name='refm_projects'
      AND column_name IN ('status','priority','sort_order') ORDER BY column_name`);
  const chk = await c.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid='public.refm_projects'::regclass AND conname='refm_projects_status_check'`);
  const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename='refm_projects' AND indexname='idx_refm_projects_card_order'`);
  const data = await c.query(`SELECT status, count(*)::int AS n FROM public.refm_projects GROUP BY 1 ORDER BY 1`);
  return {
    columns: cols.rows,
    statusCheck: chk.rows[0]?.def ?? null,
    cardIndex: idx.rows[0]?.indexname ?? null,
    statusData: data.rows,
  };
}

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const sql = migrationBody();

  console.log('=== BEFORE ===');
  const before = await snapshot(c);
  console.log(JSON.stringify(before, null, 2));

  // ── Dry run: apply, inspect, run again, then roll back. ─────────────────
  console.log('\n=== DRY RUN (transaction, rolled back) ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    console.log('  first run: OK');
    const after = await snapshot(c);
    console.log('  status CHECK now: ' + after.statusCheck);
    console.log('  columns now: ' + JSON.stringify(after.columns));
    console.log('  card index now: ' + after.cardIndex);
    console.log('  rows by status (unchanged expected): ' + JSON.stringify(after.statusData));

    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    // Prove the new vocabulary is actually enforced.
    await c.query('SAVEPOINT probe');
    try {
      await c.query(`UPDATE public.refm_projects SET status='Active' WHERE true`);
      console.log('  ENFORCEMENT: FAILED, the old value "Active" was accepted');
    } catch (e: unknown) {
      console.log(`  ENFORCEMENT: retired value "Active" rejected (${(e as { code?: string }).code})`);
    }
    await c.query('ROLLBACK TO SAVEPOINT probe');

    await c.query('SAVEPOINT probe2');
    try {
      await c.query(`UPDATE public.refm_projects SET status='Construction' WHERE true`);
      console.log('  ENFORCEMENT: new value "Construction" accepted');
    } catch (e: unknown) {
      console.log(`  ENFORCEMENT: FAILED, new value rejected (${(e as { message?: string }).message})`);
    }
    await c.query('ROLLBACK TO SAVEPOINT probe2');
  } finally {
    await c.query('ROLLBACK');
  }
  console.log('  rolled back');

  // ── Prove the GUARD fires, on data the new CHECK cannot express. ────────
  console.log('\n=== GUARD PROBE (transaction, rolled back) ===');
  await c.query('BEGIN');
  try {
    // Drop the OLD check first so an out-of-set value can be planted at all,
    // then run the migration and confirm it REFUSES rather than proceeding.
    await c.query('ALTER TABLE refm_projects DROP CONSTRAINT IF EXISTS refm_projects_status_check');
    const upd = await c.query(`UPDATE public.refm_projects SET status='IC Review'
      WHERE id = (SELECT id FROM public.refm_projects LIMIT 1)`);
    console.log(`  planted an out-of-set status on ${upd.rowCount} row(s)`);
    try {
      await c.query(sql);
      console.log('  GUARD: FAILED, the migration proceeded over an unmappable value');
    } catch (e: unknown) {
      console.log(`  GUARD: fired as intended -> ${String((e as { message?: string }).message).slice(0, 160)}`);
    }
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
