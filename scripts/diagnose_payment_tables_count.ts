/**
 * scripts/diagnose_payment_tables_count.ts
 *
 * READ-ONLY row counts for the payment bookkeeping tables, to distinguish
 * "my query missed them" from "these tables are genuinely empty".
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_payment_tables_count.ts
 */

import { getServerClient } from '../src/core/db/supabase';

async function count(sb: any, table: string): Promise<string> {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) return `ERROR ${error.message}`;
  return String(count ?? 0);
}

async function main() {
  const sb = getServerClient();
  for (const t of ['payment_webhook_events', 'payment_transactions', 'user_platform_subscriptions', 'subscription_email_log', 'manual_invoices']) {
    console.log(`${t.padEnd(30)} ${await count(sb, t)}`);
  }

  console.log('\n=== user_platform_subscriptions detail ===');
  const { data: rows } = await sb
    .from('user_platform_subscriptions')
    .select('user_id, platform_slug, plan_key, source, status, paddle_subscription_id, started_at, expires_at')
    .order('updated_at', { ascending: false })
    .limit(20);
  for (const r of rows ?? []) {
    console.log(`  ${r.platform_slug} plan=${r.plan_key} source=${r.source} status=${r.status} paddle_sub=${r.paddle_subscription_id ?? '-'} started=${r.started_at ?? '-'} expires=${r.expires_at ?? '-'}`);
  }

  console.log('\n=== payment_transactions detail (any source) ===');
  const { data: tx } = await sb
    .from('payment_transactions')
    .select('source, external_id, plan_key, amount_minor, currency, status, billed_at')
    .order('billed_at', { ascending: false })
    .limit(20);
  for (const r of tx ?? []) {
    console.log(`  ${r.source} ${r.external_id ?? '-'} plan=${r.plan_key ?? '-'} ${(Number(r.amount_minor) / 100).toFixed(2)} ${r.currency ?? ''} status=${r.status} billed=${r.billed_at ?? '-'}`);
  }
  if (!tx?.length) console.log('  (none)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
