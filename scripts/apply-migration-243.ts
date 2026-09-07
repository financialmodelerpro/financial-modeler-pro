/**
 * apply-migration-243.ts
 *
 * Applies 243_asset_type_rates_and_order.sql, and proves it first:
 *   1. All four columns exist and are NULLABLE (blank is representable).
 *   2. A pre-243 shaped insert (name + area standards only) reads NULL on
 *      every new column: the extension is additive, nothing is invented.
 *   3. Blank vs typed zero stays distinct for BOTH new numerics.
 *   4. Every known revenue rate unit is accepted and an unknown one refused.
 *   5. A negative construction cost and a negative revenue rate are refused.
 *   6. sort_order distinguishes NULL (never reordered) from 0 (first).
 *   7. Idempotent re-run (constraints are added once, not duplicated).
 *   8. No probe rows left.
 *
 * Run: npx tsx scripts/apply-migration-243.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-243.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/243_asset_type_rates_and_order.sql';
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
  console.log(`=== migration 243 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const cols = await c.query(`
      SELECT column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'refm_asset_types'
         AND column_name IN ('construction_cost_per_sqm', 'revenue_rate', 'revenue_rate_unit', 'sort_order')`);
    check('1 all four columns exist and are NULLABLE',
      cols.rows.length === 4 && cols.rows.every((r) => r.is_nullable === 'YES'),
      JSON.stringify(cols.rows));

    const stamp = Date.now();
    const holderId = String((await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
      [`probe243+${stamp}@example.invalid`, 'Probe 243'])).rows[0].id);
    const accountId = String((await c.query(
      `SELECT id FROM accounts WHERE owner_user_id = $1`, [holderId])).rows[0].id);

    // 2: a pre-243 shaped insert invents nothing.
    await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, avg_unit_size, parking_ratio)
       VALUES ($1, $2, 'probe-legacy', 'Probe Legacy', 450, 0)`, [accountId, holderId]);
    const legacy = (await c.query(
      `SELECT construction_cost_per_sqm, revenue_rate, revenue_rate_unit, sort_order
         FROM refm_asset_types WHERE account_id = $1 AND entry_id = 'probe-legacy'`, [accountId])).rows[0];
    check('2 a pre-243 shaped row reads NULL on every new column (additive, nothing invented)',
      legacy.construction_cost_per_sqm === null && legacy.revenue_rate === null
      && legacy.revenue_rate_unit === null && legacy.sort_order === null);

    // 3: blank vs typed zero, both new numerics.
    await c.query(
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, construction_cost_per_sqm, revenue_rate, revenue_rate_unit, sort_order)
       VALUES ($1, $2, 'probe-zero', 'Probe Zero', 0, 0, 'per_sqm', 0)`, [accountId, holderId]);
    const zero = (await c.query(
      `SELECT construction_cost_per_sqm, revenue_rate, sort_order FROM refm_asset_types
        WHERE account_id = $1 AND entry_id = 'probe-zero'`, [accountId])).rows[0];
    check('3 blank stays NULL and typed zero stays 0, on both new rate columns',
      legacy.construction_cost_per_sqm === null && legacy.revenue_rate === null
      && Number(zero.construction_cost_per_sqm) === 0 && Number(zero.revenue_rate) === 0);

    // 4: the unit vocabulary.
    let allUnitsOk = true;
    for (const unit of ['per_sqm', 'per_unit', 'per_sqm_year', 'adr_per_key_night']) {
      await c.query('SAVEPOINT u');
      try {
        await c.query(
          `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, revenue_rate, revenue_rate_unit)
           VALUES ($1, $2, $3, 'Probe Unit', 100, $4)`,
          [accountId, holderId, `probe-unit-${unit.replace(/_/g, '-')}`, unit]);
        await c.query('RELEASE SAVEPOINT u');
      } catch (e) {
        allUnitsOk = false;
        await c.query('ROLLBACK TO SAVEPOINT u');
        console.log(`      unit ${unit} rejected: ${(e as Error).message}`);
      }
    }
    const badUnit = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, revenue_rate, revenue_rate_unit)
       VALUES ($1, $2, 'probe-bad-unit', 'Probe Bad Unit', 100, 'per_furlong')`,
      [accountId, holderId], /revenue_rate_unit|check constraint/i);
    check('4 all four known revenue rate units accepted, an unknown one refused', allUnitsOk && badUnit.ok, badUnit.msg);

    const negCost = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, construction_cost_per_sqm)
       VALUES ($1, $2, 'probe-neg-cost', 'Probe Neg Cost', -1)`,
      [accountId, holderId], /construction_cost|check constraint/i);
    const negRate = await refuses(c,
      `INSERT INTO refm_asset_types (account_id, user_id, entry_id, label, revenue_rate)
       VALUES ($1, $2, 'probe-neg-rate', 'Probe Neg Rate', -1)`,
      [accountId, holderId], /revenue_rate|check constraint/i);
    check('5 a negative construction cost and a negative revenue rate are refused',
      negCost.ok && negRate.ok, `${negCost.msg} / ${negRate.msg}`);

    check('6 sort_order distinguishes NULL (never reordered) from 0 (first)',
      legacy.sort_order === null && Number(zero.sort_order) === 0);

    await c.query(migrationBody());
    const dupes = await c.query(`
      SELECT conname, count(*)::int AS n FROM pg_constraint
       WHERE conname IN ('refm_asset_types_construction_cost_nonneg',
                         'refm_asset_types_revenue_rate_nonneg',
                         'refm_asset_types_revenue_rate_unit_known')
       GROUP BY conname`);
    check('7 idempotent: re-run leaves exactly one of each new constraint',
      dupes.rows.length === 3 && dupes.rows.every((r) => Number(r.n) === 1), JSON.stringify(dupes.rows));

    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const leftAll = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE entry_id LIKE 'probe-%'`);
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe243%'`);
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
