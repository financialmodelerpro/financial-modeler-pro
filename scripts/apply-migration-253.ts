/**
 * apply-migration-253.ts
 *
 * Applies 253_live_session_content_sections.sql, and proves it first:
 *   1. The column exists, jsonb, NOT NULL, default '{}'.
 *   2. Every existing session reads '{}' (nothing changed for any course).
 *   3. A list object writes and reads back (inside the transaction only).
 *   4. Idempotent: running the body twice is fine.
 *
 * Run: npx tsx scripts/apply-migration-253.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-253.ts --apply  (commits)
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

const SQL = readFileSync('supabase/migrations/253_live_session_content_sections.sql', 'utf8');
const APPLY = process.argv.includes('--apply');
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 253 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);
  try {
    await c.query('BEGIN');
    await c.query(SQL);
    const col = await c.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'live_sessions' AND column_name = 'content_sections'`);
    const r = col.rows[0] ?? {};
    check('1 content_sections is jsonb, NOT NULL, default {}', r.data_type === 'jsonb' && r.is_nullable === 'NO' && /'\{\}'/.test(String(r.column_default)), JSON.stringify(r));
    const n = await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE content_sections <> '{}'::jsonb)::int AS changed FROM live_sessions`);
    check('2 every existing session reads {} (no course changes)', Number(n.rows[0].changed) === 0, JSON.stringify(n.rows[0]));
    await c.query('SAVEPOINT probe');
    const any = await c.query(`SELECT id FROM live_sessions LIMIT 1`);
    if (any.rows[0]) {
      await c.query(`UPDATE live_sessions SET content_sections = $1 WHERE id = $2`, [JSON.stringify({ overview: ['a', 'b'] }), any.rows[0].id]);
      const back = await c.query(`SELECT content_sections FROM live_sessions WHERE id = $1`, [any.rows[0].id]);
      check('3 a list object writes and reads back', JSON.stringify((back.rows[0].content_sections as { overview: string[] }).overview) === '["a","b"]');
    }
    await c.query('ROLLBACK TO SAVEPOINT probe');
    await c.query(SQL);
    check('4 idempotent (the body runs twice)', true);
    if (APPLY && fail === 0) { await c.query('COMMIT'); console.log('\nCOMMITTED.'); }
    else { await c.query('ROLLBACK'); console.log(`\nRolled back (${APPLY ? 'a check failed' : 'dry run'}).`); }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(e); fail++;
  } finally { await c.end(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
