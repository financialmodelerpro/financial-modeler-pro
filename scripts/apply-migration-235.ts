/**
 * apply-migration-235.ts
 *
 * Applies 235_module_labels_derive_the_number.sql, and proves it first.
 *
 * WHAT IS PROVED, and why each one is here:
 *
 *   1. THE BEFORE STATE IS REAL. The migration exists because storage carried
 *      a display number. If no stored label matches /^Module \d+/ then the
 *      premise is already false and applying would be cargo cult, so the dry
 *      run REPORTS what it found rather than assuming.
 *   2. AFTER: no module label carries a number, in any form.
 *   3. IDENTITY IS UNTOUCHED. feature_key, active, display_order, category and
 *      build_status are compared row by row, before against after. This is a
 *      label migration and it must not be able to move an entitlement.
 *   4. plan_permissions IS UNTOUCHED. The whole point of not renumbering is
 *      that module_8 stays granted to solo/pro/firm and module_10 does not
 *      quietly join them, so the grant set is counted before and after.
 *   5. IDEMPOTENT. The body runs twice inside the transaction and the second
 *      run changes nothing.
 *
 * Run: npx tsx scripts/apply-migration-235.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-235.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/235_module_labels_derive_the_number.sql';
const APPLY = process.argv.includes('--apply');
const NUMBER_PREFIX = /^\s*Module\s*\d+\s*[:,-]/i;

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

interface ModuleRow { feature_key: string; label: string; category: string; feature_type: string; build_status: string; display_order: number; active: boolean }

async function moduleRows(c: PgClient): Promise<ModuleRow[]> {
  const r = await c.query(`SELECT feature_key, label, category, feature_type, build_status, display_order, active
    FROM features_registry WHERE feature_key ~ '^module_[0-9]+$' ORDER BY feature_key`);
  return r.rows as unknown as ModuleRow[];
}

async function grantFingerprint(c: PgClient): Promise<string> {
  const r = await c.query(`SELECT plan_key, feature_key, included FROM plan_permissions
    WHERE feature_key ~ '^module_[0-9]+$' ORDER BY plan_key, feature_key`);
  return r.rows.map((x) => `${x.plan_key}/${x.feature_key}=${x.included}`).join(',');
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 235 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');

    const before = await moduleRows(c);
    const grantsBefore = await grantFingerprint(c);
    const numbered = before.filter((r) => NUMBER_PREFIX.test(r.label));
    console.log(`  module rows: ${before.length}, of which carry a "Module N" prefix: ${numbered.length}`);
    for (const r of numbered) console.log(`    ${r.feature_key} -> ${JSON.stringify(r.label)}`);
    console.log();
    // 1. The premise. Stated rather than assumed: on a re-run this is 0 and
    //    that is a PASS too, because idempotence is the point.
    check('1 the before state was read (rows exist to migrate or already migrated)', before.length === 11, String(before.length));

    await c.query(migrationBody());

    const after = await moduleRows(c);
    const grantsAfter = await grantFingerprint(c);

    // 2. No number survives anywhere in a module label.
    const stillNumbered = after.filter((r) => NUMBER_PREFIX.test(r.label) || /module\s*\d+/i.test(r.label));
    check('2 no module label carries a number', stillNumbered.length === 0,
      stillNumbered.map((r) => `${r.feature_key}=${r.label}`).join('; '));

    // 3. Identity untouched, row by row. A label migration must not move a key.
    const idOf = (r: ModuleRow) => `${r.feature_key}|${r.category}|${r.feature_type}|${r.build_status}|${r.display_order}|${r.active}`;
    const beforeIds = before.map(idOf).join(',');
    const afterIds = after.map(idOf).join(',');
    check('3 feature_key / category / type / build_status / order / active all unchanged',
      beforeIds === afterIds, `before=${beforeIds}\nafter =${afterIds}`);

    // 4. The grants are the reason this is not a renumber. Count them.
    check('4 plan_permissions module grants byte-identical', grantsBefore === grantsAfter);
    check('4b module_8 is still granted to solo/pro/firm (the collision that made 8 unusable)',
      /solo\/module_8=true/.test(grantsAfter) && /pro\/module_8=true/.test(grantsAfter) && /firm\/module_8=true/.test(grantsAfter),
      grantsAfter);
    check('4c module_10 did NOT inherit those grants',
      /solo\/module_10=false/.test(grantsAfter) && /pro\/module_10=false/.test(grantsAfter), grantsAfter);

    // 5. Idempotent: run it again, nothing moves.
    await c.query(migrationBody());
    const twice = await moduleRows(c);
    check('5 idempotent (second run changes nothing)',
      JSON.stringify(twice) === JSON.stringify(after));

    console.log('\n  labels after:');
    for (const r of after) console.log(`    ${r.feature_key.padEnd(10)} -> ${JSON.stringify(r.label)}`);

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
    try { await c.query('ROLLBACK'); } catch { /* already gone */ }
    console.error('FAILED:', (e as Error).message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
