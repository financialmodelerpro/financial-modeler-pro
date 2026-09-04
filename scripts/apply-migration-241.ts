/**
 * apply-migration-241.ts
 *
 * Applies 241_cost_catalog_account_scope.sql, and proves it first:
 *   1. account_id exists, NOT NULL, FK to accounts ON DELETE CASCADE.
 *   2. An entry inserts keyed to an ACCOUNT with its author recorded.
 *   3. TWO members of one account cannot hold the same entry_id (the unique
 *      moved to the account), while a DIFFERENT account can.
 *   4. Deleting the AUTHOR leaves the entry standing, author NULL: a member
 *      leaving no longer deletes vocabulary the team still uses.
 *   5. Deleting the account holder cascades the account AND its catalog.
 *   6. Idempotent re-run.
 *   7. No probe rows left.
 *
 * Run: npx tsx scripts/apply-migration-241.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-241.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/241_cost_catalog_account_scope.sql';
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
  console.log(`=== migration 241 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const col = await c.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'refm_cost_catalog' AND column_name = 'account_id'`);
    check('1 account_id exists and is NOT NULL', col.rows[0]?.is_nullable === 'NO');

    const stamp = Date.now();
    const mkUser = async (tag: string) => String((await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe241-${tag}+${stamp}@example.invalid`, `Probe 241 ${tag}`])).rows[0].id);
    const holderId = await mkUser('holder');
    const acct = await c.query(`SELECT id FROM accounts WHERE owner_user_id = $1`, [holderId]);
    const accountId = String(acct.rows[0].id);
    const memberId = await mkUser('member');
    await c.query(`UPDATE users SET account_id = $1 WHERE id = $2`, [accountId, memberId]);
    await c.query(`DELETE FROM accounts WHERE owner_user_id = $1`, [memberId]);
    const otherId = await mkUser('other');
    const otherAcct = String((await c.query(`SELECT id FROM accounts WHERE owner_user_id = $1`, [otherId])).rows[0].id);

    const ins = await c.query(
      `INSERT INTO refm_cost_catalog (account_id, user_id, entry_id, label, method, stage)
       VALUES ($1, $2, 'probe-fees', 'Probe Fees', 'fixed_amount', 'soft') RETURNING id`,
      [accountId, memberId]);
    check('2 an entry inserts keyed to the ACCOUNT with its author recorded', !!ins.rows[0].id);

    const dup = await refuses(c,
      `INSERT INTO refm_cost_catalog (account_id, user_id, entry_id, label, method, stage)
       VALUES ($1, $2, 'probe-fees', 'Probe Fees Again', 'fixed_amount', 'soft')`,
      [accountId, holderId], /account_entry_unique|duplicate key/i);
    check('3a a second member cannot duplicate the entry id on the SAME account', dup.ok, dup.msg);
    const otherIns = await c.query(
      `INSERT INTO refm_cost_catalog (account_id, user_id, entry_id, label, method, stage)
       VALUES ($1, $2, 'probe-fees', 'Probe Fees Elsewhere', 'fixed_amount', 'soft') RETURNING id`,
      [otherAcct, otherId]);
    check('3b a DIFFERENT account may hold the same entry id', !!otherIns.rows[0].id);

    await c.query(`DELETE FROM users WHERE id = $1`, [memberId]);
    const orphan = await c.query(
      `SELECT user_id FROM refm_cost_catalog WHERE account_id = $1 AND entry_id = 'probe-fees'`, [accountId]);
    check('4 deleting the AUTHOR leaves the entry standing, author NULL',
      orphan.rows.length === 1 && orphan.rows[0].user_id === null);

    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const left = await c.query(`SELECT count(*)::int AS n FROM refm_cost_catalog WHERE account_id = $1`, [accountId]);
    check('5 deleting the holder cascades the account AND its catalog', Number(left.rows[0].n) === 0);

    await c.query(migrationBody());
    const uniq = await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'refm_cost_catalog_account_entry_unique'`);
    check('6 idempotent: re-run leaves one account unique and no user unique',
      Number(uniq.rows[0].n) === 1
      && Number((await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'refm_cost_catalog_user_entry_unique'`)).rows[0].n) === 0);

    await c.query(`DELETE FROM users WHERE id = $1`, [otherId]);
    const leftAll = await c.query(`SELECT count(*)::int AS n FROM refm_cost_catalog WHERE entry_id = 'probe-fees'`);
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe241-%'`);
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
