/**
 * scripts/diagnose_paddle_scopes.ts
 *
 * READ-ONLY diagnosis of the configured Paddle server API key: which scopes it
 * actually carries, and specifically whether price.read now works after the key
 * was re-pasted.
 *
 * Every call is a GET. Nothing is written to Paddle, and nothing is written to
 * the database. Safe to run against live billing.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/diagnose_paddle_scopes.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { getServerClient } from '../src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom } from '../src/shared/payments/config';
import { paddleApiBase } from '../src/shared/payments/paddleApi';

const PLATFORM = process.argv[2] ?? 'real-estate';

interface Probe {
  label: string;
  path: string;
  scope: string;
  status: number;
  ok: boolean;
  errorCode: string | null;
  errorDetail: string | null;
  count: number | null;
}

async function get(base: string, apiKey: string, path: string): Promise<{ status: number; json: unknown }> {
  try {
    const resp = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let json: unknown = null;
    try { json = await resp.json(); } catch { json = null; }
    return { status: resp.status, json };
  } catch (e) {
    return { status: 0, json: { error: { code: 'unreachable', detail: String(e) } } };
  }
}

function errOf(json: unknown): { code: string | null; detail: string | null } {
  const e = (json as { error?: { code?: string; detail?: string } } | null)?.error;
  return { code: e?.code ?? null, detail: e?.detail ?? null };
}

function countOf(json: unknown): number | null {
  const d = (json as { data?: unknown } | null)?.data;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === 'object') return 1;
  return null;
}

async function probe(base: string, apiKey: string, label: string, scope: string, path: string): Promise<Probe> {
  const { status, json } = await get(base, apiKey, path);
  const { code, detail } = errOf(json);
  return {
    label, path, scope, status,
    ok: status >= 200 && status < 300,
    errorCode: status >= 200 && status < 300 ? null : code,
    errorDetail: status >= 200 && status < 300 ? null : detail,
    count: status >= 200 && status < 300 ? countOf(json) : null,
  };
}

function mark(p: Probe): string {
  if (p.ok) return 'OK  200';
  if (p.status === 403) return 'FAIL 403';
  return `FAIL ${p.status}`;
}

async function main() {
  const sb = getServerClient();

  // 1. Config: environment flag + key shape (never print the key itself).
  const row = await loadPaymentSettings(sb, PLATFORM);
  const cfg = providerConfigFrom(row, 'paddle');
  const key = cfg.apiKey ?? '';
  const base = paddleApiBase(cfg.sandbox);

  console.log('=== Paddle config (payment_settings, platform_slug=' + PLATFORM + ') ===');
  console.log('active_provider     :', row.active_provider);
  console.log('paddle_sandbox      :', row.paddle_sandbox);
  console.log('API base            :', base);
  console.log('api key present     :', key ? 'yes' : 'NO');
  console.log('api key prefix      :', key ? key.slice(0, 8) + '...' : '-');
  console.log('api key length      :', key.length);
  const envGuess = key.startsWith('pdl_live_') ? 'LIVE' : key.startsWith('pdl_sdbx_') ? 'SANDBOX' : 'UNKNOWN-PREFIX';
  console.log('key environment     :', envGuess);
  console.log('client token prefix :', cfg.clientToken ? cfg.clientToken.slice(0, 8) + '...' : '-');
  console.log('webhook secret set  :', cfg.webhookSecret ? 'yes' : 'no');
  const mismatch =
    (row.paddle_sandbox && envGuess === 'LIVE') || (!row.paddle_sandbox && envGuess === 'SANDBOX');
  console.log('env/key mismatch    :', mismatch ? 'YES (key env does not match paddle_sandbox)' : 'no');

  if (!key) {
    console.log('\nNo API key stored. Nothing further to test.');
    return;
  }

  // 2. The stored live price ids (entitlement_plans).
  const { data: plans } = await sb
    .from('entitlement_plans')
    .select('plan_key, label, active, paddle_price_id_monthly, paddle_price_id_annual')
    .eq('platform_slug', PLATFORM)
    .order('display_order');

  const priceIds: { id: string; who: string }[] = [];
  console.log('\n=== entitlement_plans price ids ===');
  for (const p of (plans ?? []) as Record<string, string | boolean | null>[]) {
    const m = p.paddle_price_id_monthly as string | null;
    const a = p.paddle_price_id_annual as string | null;
    console.log(`- ${String(p.plan_key).padEnd(8)} active=${String(p.active).padEnd(5)} monthly=${m ?? '-'} annual=${a ?? '-'}`);
    if (m) priceIds.push({ id: m, who: `${p.plan_key} monthly` });
    if (a) priceIds.push({ id: a, who: `${p.plan_key} annual` });
  }

  // 3. THE failing call before: GET /prices/{id} per stored price id.
  console.log('\n=== GET /prices/{id} (the call that returned 403 before) ===');
  const priceProbes: Probe[] = [];
  for (const { id, who } of priceIds) {
    const p = await probe(base, key, `price ${who}`, 'price.read', `/prices/${id}`);
    priceProbes.push(p);
    console.log(`${mark(p).padEnd(9)} ${who.padEnd(16)} ${id}  ${p.ok ? '' : `[${p.errorCode ?? '?'}] ${p.errorDetail ?? ''}`}`);
  }
  if (priceIds.length === 0) console.log('(no price ids stored on any plan)');

  // 4. GET /products?include=prices (also 403 before).
  console.log('\n=== GET /products?include=prices ===');
  const prodInc = await probe(base, key, 'products+prices', 'product.read + price.read', '/products?include=prices&per_page=5');
  console.log(`${mark(prodInc).padEnd(9)} /products?include=prices  ${prodInc.ok ? `(${prodInc.count} products)` : `[${prodInc.errorCode ?? '?'}] ${prodInc.errorDetail ?? ''}`}`);

  // 5. Full scope sweep (all GET list endpoints, read-only).
  console.log('\n=== Scope sweep (GET list endpoints) ===');
  const sweep: Probe[] = [];
  for (const [label, scope, path] of [
    ['subscriptions', 'subscription.read', '/subscriptions?per_page=1'],
    ['transactions', 'transaction.read', '/transactions?per_page=1'],
    ['customers', 'customer.read', '/customers?per_page=1'],
    ['products', 'product.read', '/products?per_page=1'],
    ['prices', 'price.read', '/prices?per_page=1'],
    ['discounts', 'discount.read', '/discounts?per_page=1'],
    ['notification-settings', 'notification.read', '/notification-settings?per_page=1'],
  ] as [string, string, string][]) {
    const p = await probe(base, key, label, scope, path);
    sweep.push(p);
    console.log(`${mark(p).padEnd(9)} ${scope.padEnd(22)} ${path.padEnd(34)} ${p.ok ? `(${p.count ?? 0} rows)` : `[${p.errorCode ?? '?'}] ${p.errorDetail ?? ''}`}`);
  }

  // 6. Verdict.
  const priceOk = priceProbes.length > 0 && priceProbes.every((p) => p.ok);
  const priceAny403 = priceProbes.some((p) => p.status === 403);
  const listPrices = sweep.find((p) => p.scope === 'price.read');
  console.log('\n=== VERDICT ===');
  console.log('price.read (GET /prices/{id})  :', priceProbes.length === 0 ? 'NOT TESTED (no stored price ids)' : priceOk ? 'WORKING (200)' : priceAny403 ? 'STILL 403' : 'FAILED (non-403)');
  console.log('price.read (GET /prices list)  :', listPrices ? (listPrices.ok ? 'WORKING (200)' : `FAILED ${listPrices.status} [${listPrices.errorCode ?? '?'}]`) : 'n/a');
  console.log('products?include=prices        :', prodInc.ok ? 'WORKING (200)' : `FAILED ${prodInc.status} [${prodInc.errorCode ?? '?'}]`);
  const regressed = sweep.filter((p) => !p.ok);
  console.log('other scopes failing           :', regressed.length === 0 ? 'none' : regressed.map((p) => `${p.scope}=${p.status}`).join(', '));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
