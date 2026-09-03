/**
 * apply-migration-237.ts
 *
 * Applies 237_seats_live.sql, and proves it first.
 *
 * WHAT IS PROVED:
 *   1. The before state is read and reported, so the correction is visible
 *      rather than assumed (pro was already 1 live; 158 seeded 3).
 *   2. After: trial 1, solo 1, pro 1, firm 10, every plan `included`.
 *   3. The `seats` row no longer says "Coming soon" and reads build_status
 *      'live'.
 *   4. NOTHING ELSE MOVED. Every other plan_permissions row and every other
 *      features_registry row is compared before against after, because this is
 *      a data migration on the tables that decide what customers can do and a
 *      stray UPDATE here is an entitlement change.
 *   5. Idempotent: the body runs twice and the second run changes nothing.
 *
 * Run: npx tsx scripts/apply-migration-237.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-237.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/237_seats_live.sql';
const APPLY = process.argv.includes('--apply');
const EXPECTED: Record<string, number> = { trial: 1, solo: 1, pro: 1, firm: 10 };

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

async function seatRows(c: PgClient): Promise<Record<string, { included: boolean; limit: number | null }>> {
  const r = await c.query(
    `SELECT plan_key, included, limit_value FROM plan_permissions WHERE feature_key = 'seats' ORDER BY plan_key`);
  const out: Record<string, { included: boolean; limit: number | null }> = {};
  for (const x of r.rows) out[String(x.plan_key)] = { included: x.included === true, limit: x.limit_value as number | null };
  return out;
}

/** Everything the migration must NOT touch, as one comparable string. */
async function untouched(c: PgClient): Promise<string> {
  const pp = await c.query(
    `SELECT plan_key, feature_key, included, limit_value FROM plan_permissions
      WHERE feature_key <> 'seats' ORDER BY plan_key, feature_key`);
  const fr = await c.query(
    `SELECT feature_key, label, category, feature_type, build_status, display_order, active, visible, description
       FROM features_registry WHERE feature_key <> 'seats' ORDER BY feature_key`);
  return JSON.stringify(pp.rows) + '||' + JSON.stringify(fr.rows);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 237 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');

    const before = await seatRows(c);
    const otherBefore = await untouched(c);
    const seatBefore = await c.query(
      `SELECT build_status, description FROM features_registry WHERE feature_key = 'seats'`);
    console.log('  seat limits BEFORE:');
    for (const k of Object.keys(before).sort()) console.log(`    ${k.padEnd(6)} included=${before[k].included} limit=${before[k].limit}`);
    console.log(`  seats row BEFORE: build_status=${seatBefore.rows[0]?.build_status}`);
    console.log(`    description: ${String(seatBefore.rows[0]?.description ?? '').slice(0, 70)}...\n`);
    check('1 all four plans have a seats row to correct', Object.keys(before).length === 4, Object.keys(before).join(','));

    await c.query(migrationBody());

    const after = await seatRows(c);
    const wrong = Object.entries(EXPECTED).filter(([k, v]) => after[k]?.limit !== v || after[k]?.included !== true);
    check('2 trial 1, solo 1, pro 1, firm 10, all included', wrong.length === 0,
      wrong.map(([k, v]) => `${k} want ${v} got ${after[k]?.limit}`).join('; '));

    const seatAfter = await c.query(
      `SELECT build_status, description FROM features_registry WHERE feature_key = 'seats'`);
    const desc = String(seatAfter.rows[0]?.description ?? '');
    check('3 the seats row is live and no longer says Coming soon',
      seatAfter.rows[0]?.build_status === 'live' && !/coming soon/i.test(desc), `${seatAfter.rows[0]?.build_status} :: ${desc.slice(0, 60)}`);
    check('3b the new copy states who counts and how to get more',
      /owner uses one seat/i.test(desc) && /contact us/i.test(desc), desc.slice(0, 120));

    const otherAfter = await untouched(c);
    check('4 NOTHING else in plan_permissions or features_registry moved', otherBefore === otherAfter);

    await c.query(migrationBody());
    const twice = await seatRows(c);
    check('5 idempotent (second run changes nothing)', JSON.stringify(twice) === JSON.stringify(after));

    console.log('\n  seat limits AFTER:');
    for (const k of Object.keys(after).sort()) console.log(`    ${k.padEnd(6)} included=${after[k].included} limit=${after[k].limit}`);

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
