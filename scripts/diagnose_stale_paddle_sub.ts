/**
 * scripts/diagnose_stale_paddle_sub.ts
 *
 * READ-ONLY. Two things to settle:
 *
 *  1. user_platform_subscriptions holds a source='paddle', status='active' row
 *     with paddle_subscription_id sub_01kvz4rmzhm8q6v9nr7mc1rxew (started
 *     2026-07-06), but LIVE Paddle returns zero subscriptions in every status.
 *     Is that id a SANDBOX subscription now orphaned by the switch to live?
 *     Look it up in BOTH environments.
 *
 *  2. payment_webhook_events actually has 82 rows (an earlier probe of mine
 *     selected a non-existent column and silently rendered that as 0). Print the
 *     real column set + the most recent events.
 *
 * SELECTs and GETs only. Nothing written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_stale_paddle_sub.ts
 */

import { getServerClient } from '../src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom } from '../src/shared/payments/config';

const SUB_ID = process.argv[2] ?? 'sub_01kvz4rmzhm8q6v9nr7mc1rxew';

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

async function main() {
  const sb = getServerClient();
  const row = await loadPaymentSettings(sb, 'real-estate');
  const cfg = providerConfigFrom(row, 'paddle');
  const key = cfg.apiKey ?? '';

  // ── 1. Who holds the stale row? ───────────────────────────────────────────
  console.log('=== The source=paddle subscription row ===');
  const { data: subs } = await sb
    .from('user_platform_subscriptions')
    .select('user_id, platform_slug, plan_key, source, status, paddle_subscription_id, paddle_customer_id, started_at, current_period_end')
    .eq('paddle_subscription_id', SUB_ID);
  for (const s of subs ?? []) {
    const { data: u } = await sb.from('users').select('email, role, subscription_plan, subscription_status').eq('id', s.user_id).maybeSingle();
    console.log(`  user=${u?.email ?? s.user_id} role=${u?.role ?? '?'} users.plan=${u?.subscription_plan ?? '-'}/${u?.subscription_status ?? '-'}`);
    console.log(`  row : plan=${s.plan_key} source=${s.source} status=${s.status} sub=${s.paddle_subscription_id} cust=${s.paddle_customer_id ?? '-'} started=${s.started_at} period_end=${s.current_period_end ?? '-'}`);
    console.log(`  => isLivePaddleSubscription() = ${s.source !== 'manual' && !!s.paddle_subscription_id && s.status !== 'canceled'}  (true BLOCKS admin manual plan changes for this user)`);
  }
  if (!subs?.length) console.log('  (no row with that subscription id)');

  // ── 2. Does that id exist in LIVE? in SANDBOX? ────────────────────────────
  console.log(`\n=== GET /subscriptions/${SUB_ID} in both environments ===`);
  if (!key) { console.log('  no api key'); return; }
  const live = await get('https://api.paddle.com', key, `/subscriptions/${SUB_ID}`);
  console.log(`  LIVE    (api.paddle.com)         -> ${live.status} ${live.status === 200 ? `status=${live.json?.data?.status}` : `[${live.json?.error?.code ?? '?'}] ${live.json?.error?.detail ?? ''}`}`);
  const sbx = await get('https://sandbox-api.paddle.com', key, `/subscriptions/${SUB_ID}`);
  console.log(`  SANDBOX (sandbox-api.paddle.com) -> ${sbx.status} ${sbx.status === 200 ? `status=${sbx.json?.data?.status}` : `[${sbx.json?.error?.code ?? '?'}] ${sbx.json?.error?.detail ?? ''}`}`);
  console.log('  (the live key is not valid against sandbox, so a sandbox 401/403 only means "wrong key for that env", not "absent")');

  // ── 3. Real webhook event history ─────────────────────────────────────────
  console.log('\n=== payment_webhook_events (real columns + recent) ===');
  const probe = await sb.from('payment_webhook_events').select('*').limit(1);
  if (probe.error) { console.log('  select * error:', probe.error.message); return; }
  console.log('  columns:', Object.keys(probe.data?.[0] ?? {}).join(', ') || '(no rows)');
  const { data: recent, error: recErr } = await sb
    .from('payment_webhook_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(12);
  if (recErr) { console.log('  recent error:', recErr.message); return; }
  for (const e of recent ?? []) {
    const r = e as Record<string, unknown>;
    console.log(`  ${r.created_at} ${String(r.event_type ?? '-').padEnd(28)} plan=${r.plan_key ?? '-'} status=${r.status ?? '-'} event_id=${String(r.event_id ?? '-').slice(0, 24)}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
