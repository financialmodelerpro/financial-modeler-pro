/**
 * apply-migration-244.ts
 *
 * Applies 244_asset_type_values_move_to_project.sql, and proves it first:
 *   0. RECORDS what is about to be discarded (every row still carrying a
 *      value, and the account-standards rows), printed before the drop so the
 *      loss is stated rather than silent.
 *   1. The six value columns are gone; the vocabulary columns remain.
 *   2. Their CHECK constraints went with them (no orphan constraints).
 *   3. refm_account_standards no longer exists.
 *   4. The vocabulary still works: an entry inserts, keyed to the account,
 *      with its category and order, and the account unique still fires.
 *   5. Deleting the holder still cascades the account and its vocabulary.
 *   6. Idempotent re-run.
 *   7. No probe rows left.
 *
 * Run: npx tsx scripts/apply-migration-244.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-244.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/244_asset_type_values_move_to_project.sql';
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

/** An expected-refusal probe MUST sit behind a savepoint: the first failed
 *  statement aborts the whole transaction, so without one every later query
 *  errors and the run crashes instead of reporting (TRAPS 3.21). */
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
  console.log(`=== migration 244 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');

    // 0. State the loss BEFORE taking it.
    //
    // TOLERANT OF THE DROP HAVING ALREADY HAPPENED. This migration is
    // idempotent, so it may legitimately run against a database where the
    // columns are already gone; probing them unconditionally made the applier
    // die on its own first statement with "column does not exist", which
    // reads like a broken migration rather than an applied one.
    const hasValueCols = Number((await c.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'refm_asset_types' AND column_name = 'avg_unit_size'`)).rows[0].n) > 0;
    if (hasValueCols) {
      const doomed = await c.query(`
        SELECT label, avg_unit_size, parking_ratio, parking_ratio_basis,
               construction_cost_per_sqm, revenue_rate, revenue_rate_unit
          FROM refm_asset_types
         WHERE avg_unit_size IS NOT NULL OR parking_ratio IS NOT NULL
            OR construction_cost_per_sqm IS NOT NULL OR revenue_rate IS NOT NULL
         ORDER BY label`);
      console.log(`  [INFO] rows carrying a value that this migration discards: ${doomed.rows.length}`);
      for (const r of doomed.rows) console.log(`         ${JSON.stringify(r)}`);
      console.log('         (re-entered on the project; see the migration header)\n');
    } else {
      console.log('  [INFO] the value columns are already gone: this database has had 244 applied.\n');
    }
    const stdsTable = (await c.query(`SELECT to_regclass('public.refm_account_standards') AS t`)).rows[0].t;
    if (stdsTable) {
      const stds = await c.query(`SELECT count(*)::int AS n FROM refm_account_standards`);
      console.log(`  [INFO] refm_account_standards rows discarded: ${stds.rows[0].n}\n`);
    }

    await c.query(migrationBody());

    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'refm_asset_types'`);
    const names = cols.rows.map((r) => String(r.column_name));
    const gone = ['avg_unit_size', 'parking_ratio', 'parking_ratio_basis',
      'construction_cost_per_sqm', 'revenue_rate', 'revenue_rate_unit'];
    const kept = ['account_id', 'user_id', 'entry_id', 'label', 'category', 'sort_order'];
    check('1 the six value columns are gone and the vocabulary columns remain',
      gone.every((g) => !names.includes(g)) && kept.every((k) => names.includes(k)),
      names.join(','));

    const cons = await c.query(`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE conname IN ('refm_asset_types_construction_cost_nonneg',
                         'refm_asset_types_revenue_rate_nonneg',
                         'refm_asset_types_revenue_rate_unit_known')`);
    check('2 their CHECK constraints went with them', Number(cons.rows[0].n) === 0);

    const tbl = await c.query(`SELECT to_regclass('public.refm_account_standards') AS t`);
    check('3 refm_account_standards no longer exists', tbl.rows[0].t === null);

    const stamp = Date.now();
    const holderId = String((await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe244+${stamp}@example.invalid`, 'Probe 244'])).rows[0].id);
    const accountId = String((await c.query(
      `SELECT id FROM accounts WHERE owner_user_id = $1`, [holderId])).rows[0].id);

    const ins = await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, category, sort_order)
       VALUES ($1, $2, 'probe-villas', 'Probe Villas', 'Residential', 0)
       RETURNING label, category, sort_order`, [accountId, holderId]);
    const dup = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label)
       VALUES ($1, $2, 'probe-villas', 'Probe Villas Again')`,
      [accountId, holderId], /account_entry_unique|duplicate key/i);
    check('4 the vocabulary still works (insert with category + order; the account unique still fires)',
      ins.rows[0]?.label === 'Probe Villas' && ins.rows[0]?.category === 'Residential'
      && Number(ins.rows[0]?.sort_order) === 0 && dup.ok, dup.msg);

    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const left = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE account_id = $1`, [accountId]);
    check('5 deleting the holder still cascades the account and its vocabulary', Number(left.rows[0].n) === 0);

    await c.query(migrationBody());
    const stillGone = await c.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'refm_asset_types' AND column_name = 'revenue_rate'`);
    check('6 idempotent: a re-run is a no-op', Number(stillGone.rows[0].n) === 0);

    const leftAll = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE entry_id LIKE 'probe-%'`);
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe244%'`);
    check('7 no probe rows are left behind', Number(leftAll.rows[0].n) === 0 && Number(leftU.rows[0].n) === 0);

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
