/**
 * scripts/audit-migration-flags.ts
 *
 * Read-only audit of the migration-status flags recorded in CLAUDE-DB.md.
 *
 * Background: CLAUDE-DB.md carried eleven "PENDING apply to prod" / "PENDING
 * manual apply" markers, while CLAUDE.md stated several of the same migrations
 * were applied. The two documents cannot both be right, and a wrong flag has a
 * real cost either way: a false PENDING invites a duplicate apply, a false
 * APPLIED hides a missing column until something 500s in production.
 *
 * The docs cannot settle it. Only the database can, so this probes the live
 * schema for the object each migration creates.
 *
 * THE DOC FLAG IS READ FROM THE DOC (2026-09-01). It used to be a `doc` field
 * HARDCODED beside each probe, mirroring what CLAUDE-DB.md said on the day this
 * file was written. The 2026-08-16 sweep then cleared all eleven PENDING markers
 * from the document and nobody updated the copy in here, so for two weeks this
 * script reported "Flags to correct: 11" on every run, naming eleven migrations
 * the document already recorded as APPLIED. That is the mirrored-list failure
 * the rest of this repo keeps finding: a list whose correctness is defined by
 * ANOTHER list, maintained by hand, drifts. Worse than merely wrong, it made the
 * tool useless as a signal, because a REAL stale flag would have arrived in a
 * pile of eleven false ones nobody reads.
 *
 * So the script can no longer hold an opinion about what the document says. It
 * PARSES CLAUDE-DB.md, and where the document has no clear marker it reports
 * that rather than assuming either way.
 *
 * Method: PostgREST returns a distinguishable error per failure mode.
 *   42P01 / PGRST205 -> the TABLE does not exist
 *   42703 / PGRST204 -> the table exists but the COLUMN does not
 *   no error         -> the object is present, so the migration is applied
 * A select with .limit(0) reads no rows, so this touches no data.
 *
 * Read-only. Issues no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit-migration-flags.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * No em dashes in this file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getServerClient } from '../src/core/db/supabase';

/** What CLAUDE-DB.md says, as READ from it. The last two are not statuses: they
 *  are the honest answers when the document does not state one, and they are
 *  never collapsed into APPLIED or PENDING. */
type DocFlag = 'PENDING' | 'APPLIED' | 'NO MARKER' | 'DIVERGED' | 'NOT IN DOC';

interface Probe {
  migration: string;
  table: string;
  /** Null probes the table only. */
  column: string | null;
}

// ── Reading the document ────────────────────────────────────────────────────

const DB_DOC = path.resolve(__dirname, '..', 'CLAUDE-DB.md');

/**
 * The status marker in one migration-log row.
 *
 * CASE IS THE DISCRIMINATOR, deliberately. The document uses UPPERCASE APPLIED
 * and PENDING as status markers, and lowercase "applied" / "pending" freely in
 * prose: "applied at the effective date by the cron", "pending/approved/declined"
 * as an enum's values, "a pending schedule". Thirteen rows contain a lowercase
 * "pending" with no status marker at all, so a case-insensitive match would
 * invent thirteen PENDING flags out of description text.
 */
function markerIn(rowText: string): 'APPLIED' | 'PENDING' | 'NO MARKER' {
  const applied = /\bAPPLIED\b/.test(rowText);
  const pending = /\bPENDING\b/.test(rowText);
  if (applied && pending) return 'NO MARKER'; // says both: not a usable claim
  if (applied) return 'APPLIED';
  if (pending) return 'PENDING';
  return 'NO MARKER';
}

/**
 * Every migration row in CLAUDE-DB.md, with its flag.
 *
 * A migration can appear on MORE THAN ONE row (47 do, as of 2026-09-01, every
 * pair byte-identical). Duplicates that AGREE are fine; duplicates that
 * DISAGREE are reported as DIVERGED and never resolved by picking one, because
 * picking one is how you launder a contradiction into a fact.
 */
function readDocFlags(): Map<string, { flag: DocFlag; rows: number }> {
  const lines = fs.readFileSync(DB_DOC, 'utf8').split(/\r?\n/);
  const rows = new Map<string, string[]>();
  const add = (key: string, line: string): void => {
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(line);
  };
  for (const line of lines) {
    // 1. The migration TABLE, one row per migration.
    const m = line.match(/^\|\s*`([0-9a-z][0-9a-z_]*)\.sql`\s*\|/i);
    if (m) { add(m[1], line); continue; }

    // 2. THE HEAD BLOCKQUOTES. The newest migrations are recorded as
    //    "> **Migration head: `NNN_x.sql` (APPLIED ...)**" and
    //    "> **Previous head: ...**", NOT as table rows, and they are added to
    //    the table only later. Reading table rows alone therefore made the
    //    MOST RECENT migrations invisible to the one tool that checks flags,
    //    which is exactly backwards: 227 and 228 both reported NOT IN DOC while
    //    the document recorded them APPLIED two lines from the top.
    const h = line.match(/^>\s*\*\*(?:Migration head|Previous head):\s*`([0-9a-z][0-9a-z_]*)\.sql`/i);
    if (h) add(h[1], line);
  }
  const out = new Map<string, { flag: DocFlag; rows: number }>();
  for (const [key, texts] of rows) {
    const flags = [...new Set(texts.map(markerIn))];
    out.set(key, { flag: flags.length === 1 ? flags[0] : 'DIVERGED', rows: texts.length });
  }
  return out;
}

/**
 * WHAT TO PROBE, and how. This is the only thing the script legitimately knows
 * that the document does not: which table or column each migration creates.
 * There is deliberately NO status field here any more; see the header.
 *
 * The set spans migrations the document records both ways, which is the half
 * that matters most: a false PENDING is noisy, a false APPLIED is a live outage
 * waiting to happen, and an audit that only checks the PENDING ones cannot find
 * it. Anything in the document but not in this list is reported as UNCOVERED
 * rather than passed over in silence.
 */
const PROBES: Probe[] = [
  { migration: '170_payment_paddle_client_token', table: 'payment_settings', column: 'paddle_client_token' },
  { migration: '171_payment_webhook_events', table: 'payment_webhook_events', column: null },
  { migration: '172_users_company_job_title', table: 'users', column: 'job_title' },
  { migration: '173_trial_requests', table: 'trial_requests', column: null },
  { migration: '176_users_paddle_subscription', table: 'users', column: 'paddle_subscription_id' },
  { migration: '177_user_platform_subscriptions', table: 'user_platform_subscriptions', column: null },
  { migration: '178_scheduled_plan_change', table: 'user_platform_subscriptions', column: 'scheduled_plan_key' },
  { migration: '179_manual_subscriptions', table: 'user_platform_subscriptions', column: 'source' },
  { migration: '180_payment_ledger_and_convert', table: 'payment_transactions', column: null },
  { migration: '186_platform_modules_include_in_pdf', table: 'platform_modules', column: 'include_in_pdf' },
  { migration: '189_article_hero_position', table: 'articles', column: 'hero_before_content' },
  { migration: '181_subscription_email_log', table: 'subscription_email_log', column: null },
  { migration: '182_manual_invoices', table: 'manual_invoices', column: null },
  { migration: '183_scheduled_cancel_at', table: 'user_platform_subscriptions', column: 'scheduled_cancel_at' },
  { migration: '184_coupon_paddle_reference', table: 'coupon_codes', column: 'paddle_discount_id' },
  { migration: '185_reviewed_model_return', table: 'model_submissions', column: 'reviewed_file_path' },
  { migration: '190_refm_parties', table: 'refm_parties', column: null },
  { migration: '199_report_decks', table: 'refm_report_decks', column: null },
  { migration: '203_ai_feature_registry', table: 'ai_features', column: null },
  { migration: '205_ai_usage_metering', table: 'ai_usage_counters', column: null },
  { migration: '207_refm_report_deck_versions', table: 'refm_report_deck_versions', column: null },
  { migration: '208_refm_fund_terms', table: 'refm_fund_terms', column: null },
  { migration: '209_refm_fund_terms_extended', table: 'refm_fund_terms', column: 'fund_structure_fee_pct' },
  { migration: '210_refm_fund_manager', table: 'refm_fund_terms', column: 'fund_manager_name' },
  { migration: '211_refm_fund_size_override', table: 'refm_fund_terms', column: 'fund_size_override' },
  { migration: '212_public_api_audit', table: 'public_api_audit', column: null },
  { migration: '213_public_api_keys', table: 'public_api_keys', column: null },
  { migration: '214_refm_cost_catalog', table: 'refm_cost_catalog', column: null },
  // 215 was recorded NOT APPLIED when it was written (2026-08-18) and applied
  // by hand on 2026-08-19. Probed rather than believed, which is the whole point
  // of this script: a marker in prose is not evidence either way.
  { migration: '215_refm_fund_fee_funding', table: 'refm_fund_terms', column: 'management_fee_funding' },
  // 219 shipped 2026-08-30 flagged PENDING (the session could not run DDL: the
  // stored DATABASE_URL password is stale) and was applied by the founder the
  // same day, then probed live before the flag was cleared.
  { migration: '219_account_deletions', table: 'account_deletions', column: null },
  // 227 and 228 change CONSTRAINTS, not shape, so an object probe cannot see
  // them: this script proves a table or column EXISTS and says so in its own
  // header. They are covered by scripts/audit-constraints-live.ts, which reads
  // pg_constraint directly. Listed here with the object each touches so the
  // coverage line counts them rather than leaving them silently unprobed.
  { migration: '227_admin_audit_log_admin_id_declare_live_shape', table: 'admin_audit_log', column: 'admin_id' },
  { migration: '228_declared_constraints_branding_scope_and_watch_history', table: 'session_watch_history', column: 'watch_seconds' },
];

/**
 * A NOTE ON WHAT THIS SCRIPT CANNOT SETTLE.
 *
 * It proves an object EXISTS. It does not prove a CHECK constraint, a default,
 * a NOT NULL or an index came with it, because PostgREST exposes no catalog
 * read and the only behavioural test is a write that would violate the
 * constraint. On a table holding live rows that is not a test worth running:
 * if the constraint is absent the "test" is the damage.
 *
 * Do not be tempted by a write that matches no rows. An UPDATE with a WHERE
 * that selects nothing never evaluates a CHECK, because no row is written, so
 * it returns success whether the constraint exists or not. That reads as proof
 * and is not, which is exactly the shape of failure this script was written
 * after (see docs/TRAPS.md section 10 on checks that cannot fire).
 */

type Live = 'present' | 'no-table' | 'no-column' | 'unknown';

interface Result extends Probe {
  live: Live;
  detail: string;
  doc: DocFlag;
  docRows: number;
}

async function probe(
  db: ReturnType<typeof getServerClient>,
  p: Probe,
  docFlags: Map<string, { flag: DocFlag; rows: number }>,
): Promise<Result> {
  const d = docFlags.get(p.migration);
  const base = { ...p, doc: (d?.flag ?? 'NOT IN DOC') as DocFlag, docRows: d?.rows ?? 0 };
  const sel = p.column ?? '*';
  const { error } = await db.from(p.table).select(sel).limit(0);
  if (!error) return { ...base, live: 'present', detail: 'ok' };

  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  // Table-absent and column-absent are distinct failures and must not be
  // collapsed: "no such table" against a column probe would otherwise be
  // reported as a missing column on a table that is itself missing.
  if (code === '42P01' || code === 'PGRST205' || /Could not find the table/i.test(msg)) {
    return { ...base, live: 'no-table', detail: `${code}: ${msg}` };
  }
  if (code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(msg)) {
    return { ...base, live: 'no-column', detail: `${code}: ${msg}` };
  }
  return { ...base, live: 'unknown', detail: `${code}: ${msg}` };
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local');
    process.exit(2);
  }
  const db = getServerClient();
  const docFlags = readDocFlags();

  const results: Result[] = [];
  for (const p of PROBES) results.push(await probe(db, p, docFlags));

  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);

  console.log('');
  console.log('MIGRATION FLAG AUDIT (live schema)');
  console.log('='.repeat(96));
  console.log(`${pad('migration', 38)} ${pad('doc says', 9)} ${pad('live', 11)} verdict`);
  console.log('-'.repeat(96));

  const wrong: Result[] = [];
  const unclear: Result[] = [];
  for (const r of results) {
    const applied = r.live === 'present';
    let verdict: string;
    if (r.live === 'unknown') {
      verdict = 'INCONCLUSIVE (see detail)';
    } else if (r.doc !== 'APPLIED' && r.doc !== 'PENDING') {
      // The document states nothing usable. That is a finding about the
      // DOCUMENT, and it is neither a correct flag nor a wrong one.
      verdict = `doc states no usable flag (${r.doc}); live is ${applied ? 'PRESENT' : 'ABSENT'}`;
      unclear.push(r);
    } else if ((r.doc === 'APPLIED') === applied) {
      verdict = 'flag correct';
    } else if (r.doc === 'PENDING') {
      verdict = '*** FLAG WRONG: already applied ***';
      wrong.push(r);
    } else {
      verdict = '*** FLAG WRONG: NOT applied ***';
      wrong.push(r);
    }
    const probeTxt = r.column ? `${r.table}.${r.column}` : `${r.table} (table)`;
    console.log(`${pad(r.migration, 38)} ${pad(r.doc, 9)} ${pad(r.live, 11)} ${verdict}`);
    if (r.live !== 'present') console.log(`${' '.repeat(39)}probe ${probeTxt} -> ${r.detail}`);
  }

  console.log('-'.repeat(96));
  const pend = results.filter((r) => r.doc === 'PENDING');
  const pendApplied = pend.filter((r) => r.live === 'present');
  const ctrl = results.filter((r) => r.doc === 'APPLIED');
  const ctrlMissing = ctrl.filter((r) => r.live !== 'present');
  console.log(`Flags read from CLAUDE-DB.md: ${docFlags.size} migrations, ${[...docFlags.values()].reduce((a, b) => a + b.rows, 0)} rows`);
  console.log(`Flagged PENDING: ${pend.length}, of which ACTUALLY APPLIED: ${pendApplied.length}`);
  console.log(`Recorded APPLIED: ${ctrl.length}, of which NOT PRESENT: ${ctrlMissing.length}`);
  console.log(`Doc states no usable flag: ${unclear.length}${unclear.length ? ` (${unclear.map((u) => u.migration).join(', ')})` : ''}`);
  console.log(`Flags to correct: ${wrong.length}`);

  // COVERAGE, stated rather than assumed: a migration the document lists and
  // this script never probes is not evidence of anything, and a summary that
  // hides that reads as a clean bill of health for the whole log.
  const probed = new Set(PROBES.map((p) => p.migration));
  const uncovered = [...docFlags.keys()].filter((k) => !probed.has(k));
  const divergedRows = [...docFlags.entries()].filter(([, v]) => v.flag === 'DIVERGED');
  console.log(`Uncovered by this script: ${uncovered.length} of ${docFlags.size} migrations in the log`);
  if (divergedRows.length) {
    console.log(`DUPLICATE ROWS THAT DISAGREE: ${divergedRows.length} (${divergedRows.map(([k]) => k).join(', ')})`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
