/**
 * scripts/diagnose_paddle_live_activity.ts
 *
 * READ-ONLY follow-up to diagnose_paddle_scopes.ts. Answers two questions:
 *
 *  1. Live Paddle shows a customer + a transaction but zero subscriptions.
 *     What is that transaction, and did it provision anything in our DB?
 *     (i.e. is there a live payer who never got a plan?)
 *  2. Live Paddle shows zero discounts. Is a public promo still FEATURED in
 *     cms_content pointing at a discount id that does not exist on live?
 *
 * Every Paddle call is a GET; every DB call is a SELECT. Nothing is written.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/diagnose_paddle_live_activity.ts
 */

import { getServerClient } from '../src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom } from '../src/shared/payments/config';
import { paddleApiBase } from '../src/shared/payments/paddleApi';

const PLATFORM = process.argv[2] ?? 'real-estate';

async function get(base: string, apiKey: string, path: string): Promise<{ status: number; json: any }> {
  try {
    const resp = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let json: any = null;
    try { json = await resp.json(); } catch { json = null; }
    return { status: resp.status, json };
  } catch (e) {
    return { status: 0, json: { error: { detail: String(e) } } };
  }
}

function money(minor: unknown, cur: unknown): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return '-';
  return `${(n / 100).toFixed(2)} ${cur ?? ''}`.trim();
}

async function main() {
  const sb = getServerClient();
  const row = await loadPaymentSettings(sb, PLATFORM);
  const cfg = providerConfigFrom(row, 'paddle');
  const key = cfg.apiKey ?? '';
  const base = paddleApiBase(cfg.sandbox);
  console.log(`Base: ${base}  (paddle_sandbox=${row.paddle_sandbox})\n`);
  if (!key) { console.log('No API key.'); return; }

  // ── 1. Subscriptions across EVERY status (the default list may hide some) ──
  console.log('=== Subscriptions by status ===');
  const subIds: string[] = [];
  for (const status of ['active', 'trialing', 'past_due', 'paused', 'canceled']) {
    const r = await get(base, key, `/subscriptions?status=${status}&per_page=50`);
    const arr = Array.isArray(r.json?.data) ? r.json.data : [];
    console.log(`  ${status.padEnd(9)} ${r.status} -> ${arr.length}`);
    for (const s of arr) {
      subIds.push(s.id);
      console.log(`     ${s.id} customer=${s.customer_id} created=${s.created_at} next=${s.next_billed_at ?? '-'} price=${s.items?.[0]?.price?.id ?? '-'}`);
    }
  }
  const noStatus = await get(base, key, '/subscriptions?per_page=50');
  console.log(`  (no filter) ${noStatus.status} -> ${Array.isArray(noStatus.json?.data) ? noStatus.json.data.length : 'n/a'}`);

  // ── 2. The live transaction(s) in detail ──────────────────────────────────
  console.log('\n=== Transactions (live) ===');
  const tx = await get(base, key, '/transactions?per_page=25');
  const txs = Array.isArray(tx.json?.data) ? tx.json.data : [];
  console.log(`  status ${tx.status}, ${txs.length} transaction(s)`);
  const txCustomerIds = new Set<string>();
  for (const t of txs) {
    const item = t.items?.[0];
    const total = t.details?.totals?.grand_total ?? t.details?.totals?.total;
    if (t.customer_id) txCustomerIds.add(t.customer_id);
    console.log([
      `  - ${t.id}`,
      `    status=${t.status}  origin=${t.origin}`,
      `    subscription_id=${t.subscription_id ?? 'NULL'}`,
      `    customer_id=${t.customer_id ?? '-'}`,
      `    price=${item?.price?.id ?? '-'} (${item?.price?.name ?? item?.price?.description ?? '-'})`,
      `    billing_cycle=${item?.price?.billing_cycle ? `${item.price.billing_cycle.frequency}/${item.price.billing_cycle.interval}` : 'ONE-OFF (no billing_cycle)'}`,
      `    amount=${money(total, t.currency_code)}`,
      `    created=${t.created_at}  billed=${t.billed_at ?? '-'}`,
      `    discount_id=${t.discount_id ?? '-'}`,
    ].join('\n'));
  }

  // ── 3. Customers ──────────────────────────────────────────────────────────
  console.log('\n=== Customers (live) ===');
  const cust = await get(base, key, '/customers?per_page=25');
  const customers = Array.isArray(cust.json?.data) ? cust.json.data : [];
  console.log(`  status ${cust.status}, ${customers.length} customer(s)`);
  for (const c of customers) {
    console.log(`  - ${c.id}  ${c.email}  status=${c.status}  created=${c.created_at}`);
  }

  // ── 4. Did our DB record any of it? ───────────────────────────────────────
  console.log('\n=== Our DB: did the live activity provision anything? ===');

  const emails = customers.map((c: any) => String(c.email ?? '').toLowerCase()).filter(Boolean);
  if (emails.length) {
    const { data: users } = await sb
      .from('users')
      .select('id, email, role, subscription_plan, subscription_status, trial_ends_at, paddle_subscription_id, paddle_customer_id')
      .in('email', emails);
    console.log(`  users matching a live Paddle customer email: ${users?.length ?? 0}`);
    for (const u of users ?? []) {
      console.log(`  - ${u.email} plan=${u.subscription_plan} status=${u.subscription_status} role=${u.role} paddle_sub=${u.paddle_subscription_id ?? '-'} paddle_cust=${u.paddle_customer_id ?? '-'}`);
      const { data: sub } = await sb
        .from('user_platform_subscriptions')
        .select('platform_slug, plan_key, source, status, paddle_subscription_id, started_at, current_period_end, expires_at, amount_minor, scheduled_cancel_at')
        .eq('user_id', u.id);
      for (const s of sub ?? []) {
        console.log(`      row: platform=${s.platform_slug} plan=${s.plan_key} source=${s.source} status=${s.status} sub=${s.paddle_subscription_id ?? '-'} period_end=${s.current_period_end ?? '-'} expires=${s.expires_at ?? '-'} cancel_at=${s.scheduled_cancel_at ?? '-'}`);
      }
      if (!sub?.length) console.log('      row: NONE');
    }
  } else {
    console.log('  (no live customer emails to match)');
  }

  // Ledger rows for the live transaction ids
  const txIds = txs.map((t: any) => t.id);
  if (txIds.length) {
    const { data: ledger } = await sb
      .from('payment_transactions')
      .select('source, external_id, user_id, platform_slug, plan_key, amount_minor, currency, status, billed_at')
      .in('external_id', txIds);
    console.log(`\n  payment_transactions ledger rows for those txn ids: ${ledger?.length ?? 0}`);
    for (const l of ledger ?? []) {
      console.log(`  - ${l.external_id} user=${l.user_id ?? 'NULL'} plan=${l.plan_key ?? '-'} ${money(l.amount_minor, l.currency)} status=${l.status} billed=${l.billed_at ?? '-'}`);
    }
  }

  // Webhook events seen at all (live or sandbox), most recent
  const { data: events } = await sb
    .from('payment_webhook_events')
    .select('provider, event_id, event_type, plan_key, user_id, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`\n  last ${events?.length ?? 0} payment_webhook_events:`);
  for (const e of events ?? []) {
    console.log(`  - ${e.created_at} ${e.event_type} plan=${e.plan_key ?? '-'} user=${e.user_id ?? '-'} status=${e.status ?? '-'}`);
  }

  // ── 5. Featured public promo vs the (empty) live discount list ────────────
  console.log('\n=== Public promo (cms_content) vs live Paddle discounts ===');
  const { data: promo } = await sb
    .from('cms_content')
    .select('section, key, value, updated_at')
    .eq('section', 'payments')
    .like('key', 'public_promo:%');
  if (!promo?.length) {
    console.log('  No featured public promo stored. Banner correctly renders nothing.');
  } else {
    for (const p of promo) {
      console.log(`  ${p.key} = ${JSON.stringify(p.value)}  (updated ${p.updated_at})`);
    }
    const live = await get(base, key, '/discounts?per_page=50');
    const arr = Array.isArray(live.json?.data) ? live.json.data : [];
    console.log(`  live discounts available: ${arr.length}`);
    for (const p of promo) {
      let id: string | null = null;
      try {
        const v = typeof p.value === 'string' ? JSON.parse(p.value) : p.value;
        id = v?.discountId ?? v?.discount_id ?? (typeof v === 'string' ? v : null);
      } catch { id = typeof p.value === 'string' ? p.value : null; }
      const found = arr.find((d: any) => d.id === id);
      console.log(`  ${p.key}: discountId=${id ?? '?'} -> ${found ? `FOUND on live (status=${found.status}, enabled_for_checkout=${found.enabled_for_checkout})` : 'NOT on live (dangling, promo will not display)'}`);
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
