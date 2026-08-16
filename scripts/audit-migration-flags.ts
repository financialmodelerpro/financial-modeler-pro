/**
 * scripts/audit-migration-flags.ts
 *
 * Read-only audit of the migration-status flags recorded in CLAUDE-DB.md.
 *
 * Background: CLAUDE-DB.md carries eleven "PENDING apply to prod" / "PENDING
 * manual apply" markers, while CLAUDE.md states several of the same migrations
 * are applied. The two documents cannot both be right, and a wrong flag has a
 * real cost either way: a false PENDING invites a duplicate apply, a false
 * APPLIED hides a missing column until something 500s in production.
 *
 * The docs cannot settle it. Only the database can, so this probes the live
 * schema for the object each migration creates.
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

import { getServerClient } from '../src/core/db/supabase';

type DocFlag = 'PENDING' | 'APPLIED';

interface Probe {
  migration: string;
  /** What CLAUDE-DB.md currently claims. */
  doc: DocFlag;
  table: string;
  /** Null probes the table only. */
  column: string | null;
}

/**
 * The eleven flagged PENDING in CLAUDE-DB.md, plus a CONTROL GROUP of
 * migrations recorded as applied. The control group is the half that matters
 * most: a false PENDING is noisy, a false APPLIED is a live outage waiting to
 * happen, and an audit that only checks the PENDING ones cannot find it.
 */
const PROBES: Probe[] = [
  // --- flagged PENDING in CLAUDE-DB.md ---
  { migration: '170_payment_paddle_client_token', doc: 'PENDING', table: 'payment_settings', column: 'paddle_client_token' },
  { migration: '171_payment_webhook_events', doc: 'PENDING', table: 'payment_webhook_events', column: null },
  { migration: '172_users_company_job_title', doc: 'PENDING', table: 'users', column: 'job_title' },
  { migration: '173_trial_requests', doc: 'PENDING', table: 'trial_requests', column: null },
  { migration: '176_users_paddle_subscription', doc: 'PENDING', table: 'users', column: 'paddle_subscription_id' },
  { migration: '177_user_platform_subscriptions', doc: 'PENDING', table: 'user_platform_subscriptions', column: null },
  { migration: '178_scheduled_plan_change', doc: 'PENDING', table: 'user_platform_subscriptions', column: 'scheduled_plan_key' },
  { migration: '179_manual_subscriptions', doc: 'PENDING', table: 'user_platform_subscriptions', column: 'source' },
  { migration: '180_payment_ledger_and_convert', doc: 'PENDING', table: 'payment_transactions', column: null },
  { migration: '186_platform_modules_include_in_pdf', doc: 'PENDING', table: 'platform_modules', column: 'include_in_pdf' },
  { migration: '189_article_hero_position', doc: 'PENDING', table: 'articles', column: 'hero_before_content' },

  // --- control group: recorded as applied ---
  { migration: '181_subscription_email_log', doc: 'APPLIED', table: 'subscription_email_log', column: null },
  { migration: '182_manual_invoices', doc: 'APPLIED', table: 'manual_invoices', column: null },
  { migration: '183_scheduled_cancel_at', doc: 'APPLIED', table: 'user_platform_subscriptions', column: 'scheduled_cancel_at' },
  { migration: '184_coupon_paddle_reference', doc: 'APPLIED', table: 'coupon_codes', column: 'paddle_discount_id' },
  { migration: '185_reviewed_model_return', doc: 'APPLIED', table: 'model_submissions', column: 'reviewed_file_path' },
  { migration: '190_refm_parties', doc: 'APPLIED', table: 'refm_parties', column: null },
  { migration: '199_report_decks', doc: 'APPLIED', table: 'refm_report_decks', column: null },
  { migration: '203_ai_feature_registry', doc: 'APPLIED', table: 'ai_features', column: null },
  { migration: '205_ai_usage_metering', doc: 'APPLIED', table: 'ai_usage_counters', column: null },
  { migration: '207_refm_report_deck_versions', doc: 'APPLIED', table: 'refm_report_deck_versions', column: null },
  { migration: '208_refm_fund_terms', doc: 'APPLIED', table: 'refm_fund_terms', column: null },
  { migration: '209_refm_fund_terms_extended', doc: 'APPLIED', table: 'refm_fund_terms', column: 'fund_structure_fee_pct' },
  { migration: '210_refm_fund_manager', doc: 'APPLIED', table: 'refm_fund_terms', column: 'fund_manager_name' },
  { migration: '211_refm_fund_size_override', doc: 'APPLIED', table: 'refm_fund_terms', column: 'fund_size_override' },
  { migration: '212_public_api_audit', doc: 'APPLIED', table: 'public_api_audit', column: null },
];

type Live = 'present' | 'no-table' | 'no-column' | 'unknown';

interface Result extends Probe {
  live: Live;
  detail: string;
}

async function probe(db: ReturnType<typeof getServerClient>, p: Probe): Promise<Result> {
  const sel = p.column ?? '*';
  const { error } = await db.from(p.table).select(sel).limit(0);
  if (!error) return { ...p, live: 'present', detail: 'ok' };

  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  // Table-absent and column-absent are distinct failures and must not be
  // collapsed: "no such table" against a column probe would otherwise be
  // reported as a missing column on a table that is itself missing.
  if (code === '42P01' || code === 'PGRST205' || /Could not find the table/i.test(msg)) {
    return { ...p, live: 'no-table', detail: `${code}: ${msg}` };
  }
  if (code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(msg)) {
    return { ...p, live: 'no-column', detail: `${code}: ${msg}` };
  }
  return { ...p, live: 'unknown', detail: `${code}: ${msg}` };
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local');
    process.exit(2);
  }
  const db = getServerClient();

  const results: Result[] = [];
  for (const p of PROBES) results.push(await probe(db, p));

  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);

  console.log('');
  console.log('MIGRATION FLAG AUDIT (live schema)');
  console.log('='.repeat(96));
  console.log(`${pad('migration', 38)} ${pad('doc says', 9)} ${pad('live', 11)} verdict`);
  console.log('-'.repeat(96));

  const wrong: Result[] = [];
  for (const r of results) {
    const applied = r.live === 'present';
    const agrees = (r.doc === 'APPLIED') === applied;
    let verdict: string;
    if (r.live === 'unknown') {
      verdict = 'INCONCLUSIVE (see detail)';
    } else if (agrees) {
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
  console.log(`Flagged PENDING: ${pend.length}, of which ACTUALLY APPLIED: ${pendApplied.length}`);
  console.log(`Recorded APPLIED: ${ctrl.length}, of which NOT PRESENT: ${ctrlMissing.length}`);
  console.log(`Flags to correct: ${wrong.length}`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
