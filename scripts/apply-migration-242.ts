/**
 * apply-migration-242.ts
 *
 * Applies 242_asset_type_standards.sql, and proves it first:
 *   1. Both tables exist with the expected shape (account_id NOT NULL on the
 *      registry, PK on the standards row).
 *   2. An entry inserts keyed to an ACCOUNT with its author recorded, and a
 *      BLANK standard (NULL) stores distinctly from a TYPED ZERO.
 *   3. One entry id per account; a different account may hold the same id.
 *   4. An unknown parking ratio basis and a negative standard are refused.
 *   5. Deleting the AUTHOR leaves the entry standing, author NULL.
 *   6. Deleting the account holder cascades the account, its registry and its
 *      standards row.
 *   7. Idempotent re-run.
 *   8. No probe rows left.
 *
 * Run: npx tsx scripts/apply-migration-242.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-242.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/242_asset_type_standards.sql';
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
  console.log(`=== migration 242 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const col = await c.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'refm_asset_types' AND column_name = 'account_id'`);
    const pk = await c.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'refm_account_standards'::regclass AND i.indisprimary`);
    check('1 registry account_id NOT NULL; standards PK is account_id',
      col.rows[0]?.is_nullable === 'NO' && pk.rows.length === 1 && pk.rows[0].attname === 'account_id');

    const stamp = Date.now();
    const mkUser = async (tag: string) => String((await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe242-${tag}+${stamp}@example.invalid`, `Probe 242 ${tag}`])).rows[0].id);
    const holderId = await mkUser('holder');
    const acct = await c.query(`SELECT id FROM accounts WHERE owner_user_id = $1`, [holderId]);
    const accountId = String(acct.rows[0].id);
    const memberId = await mkUser('member');
    await c.query(`UPDATE users SET account_id = $1 WHERE id = $2`, [accountId, memberId]);
    await c.query(`DELETE FROM accounts WHERE owner_user_id = $1`, [memberId]);
    const otherId = await mkUser('other');
    const otherAcct = String((await c.query(`SELECT id FROM accounts WHERE owner_user_id = $1`, [otherId])).rows[0].id);

    // 2: blank (NULL) vs typed zero, on the same account, distinct rows.
    await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, avg_unit_size, parking_ratio)
       VALUES ($1, $2, 'probe-villas', 'Probe Villas', 450, 0)`,
      [accountId, memberId]);
    await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, avg_unit_size, parking_ratio)
       VALUES ($1, $2, 'probe-commercial', 'Probe Commercial', NULL, NULL)`,
      [accountId, memberId]);
    const both = await c.query(
      `SELECT entry_id, avg_unit_size, parking_ratio FROM refm_asset_types
        WHERE account_id = $1 ORDER BY entry_id`, [accountId]);
    const commercial = both.rows.find((r) => r.entry_id === 'probe-commercial');
    const villas = both.rows.find((r) => r.entry_id === 'probe-villas');
    check('2 blank stores NULL and typed zero stores 0, distinctly',
      commercial?.avg_unit_size === null && commercial?.parking_ratio === null
      && villas?.parking_ratio !== null && Number(villas?.parking_ratio) === 0
      && Number(villas?.avg_unit_size) === 450);

    const dup = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label)
       VALUES ($1, $2, 'probe-villas', 'Probe Villas Again')`,
      [accountId, holderId], /account_entry_unique|duplicate key/i);
    check('3a a second member cannot duplicate the entry id on the SAME account', dup.ok, dup.msg);
    const otherIns = await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label)
       VALUES ($1, $2, 'probe-villas', 'Probe Villas Elsewhere') RETURNING id`,
      [otherAcct, otherId]);
    check('3b a DIFFERENT account may hold the same entry id', !!otherIns.rows[0].id);

    const badBasis = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, parking_ratio_basis)
       VALUES ($1, $2, 'probe-bad', 'Probe Bad', 'per_floor')`,
      [accountId, holderId], /parking_ratio_basis|check constraint/i);
    const badNeg = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, avg_unit_size)
       VALUES ($1, $2, 'probe-neg', 'Probe Neg', -1)`,
      [accountId, holderId], /avg_unit_size|check constraint/i);
    check('4 unknown basis and negative standard are refused', badBasis.ok && badNeg.ok,
      `${badBasis.msg} / ${badNeg.msg}`);

    await c.query(
      `INSERT INTO refm_account_standards (account_id, user_id, parking_area_per_slot)
       VALUES ($1, $2, 40)`, [accountId, memberId]);

    await c.query(`DELETE FROM users WHERE id = $1`, [memberId]);
    const orphan = await c.query(
      `SELECT user_id FROM refm_asset_types WHERE account_id = $1 AND entry_id = 'probe-villas'`, [accountId]);
    const orphanStd = await c.query(
      `SELECT user_id FROM refm_account_standards WHERE account_id = $1`, [accountId]);
    check('5 deleting the AUTHOR leaves entry and standards standing, author NULL',
      orphan.rows.length === 1 && orphan.rows[0].user_id === null
      && orphanStd.rows.length === 1 && orphanStd.rows[0].user_id === null);

    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const leftTypes = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE account_id = $1`, [accountId]);
    const leftStd = await c.query(`SELECT count(*)::int AS n FROM refm_account_standards WHERE account_id = $1`, [accountId]);
    check('6 deleting the holder cascades the account, its registry and its standards',
      Number(leftTypes.rows[0].n) === 0 && Number(leftStd.rows[0].n) === 0);

    await c.query(migrationBody());
    const uniq = await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'refm_asset_types_account_entry_unique'`);
    check('7 idempotent: re-run leaves exactly one account unique', Number(uniq.rows[0].n) === 1);

    await c.query(`DELETE FROM users WHERE id = $1`, [otherId]);
    const leftAll = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE entry_id LIKE 'probe-%'`);
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe242-%'`);
    check('8 no probe rows are left behind', Number(leftAll.rows[0].n) === 0 && Number(leftU.rows[0].n) === 0);

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
