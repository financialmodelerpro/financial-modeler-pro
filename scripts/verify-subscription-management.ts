/**
 * verify-subscription-management.ts
 *
 * Proves the in-dashboard subscription management layer without any LIVE Paddle
 * network call:
 *  - the Paddle event parser now captures the subscription id + customer id from
 *    both subscription.* and transaction.completed payloads, and never throws;
 *  - the neutral event shape carries subscriptionId + customerId;
 *  - the server REST client targets the correct sandbox / live base, exposes the
 *    read/cancel/invoice operations, and gates on the server api key;
 *  - cancel is AT PERIOD END (effective_from: next_billing_period), so access is
 *    not stripped immediately;
 *  - the webhook stores the ids via the dedicated helper and does NOT write the
 *    plan columns there (enforcement path unchanged);
 *  - the four API routes are session-guarded and run server-side only;
 *  - the dashboard renders the panel; the panel makes NO direct Paddle call and
 *    never renders a card form; the API key never appears client-side;
 *  - the checkout opener fires onComplete on checkout.completed and the pricing
 *    surface redirects into the app after a successful checkout;
 *  - migration 176 adds the two id columns additively;
 *  - no em dashes in the new/edited files.
 *
 * Run: npx tsx scripts/verify-subscription-management.ts
 */
import fs from 'fs';
import path from 'path';
import { getAdapter } from '../src/shared/payments/registry';
import { paddleApiBase, paddleServerReady } from '../src/shared/payments/paddleApi';
import type { ProviderConfig } from '../src/shared/payments/types';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const EM = String.fromCharCode(0x2014);

console.log('=== Event parsing captures subscription + customer ids ===');
const subEvt = getAdapter('paddle').parseEvent(JSON.stringify({
  event_id: 'evt_1', event_type: 'subscription.activated',
  data: { id: 'sub_abc', customer_id: 'ctm_xyz', items: [{ price: { id: 'pri_1' } }], custom_data: { user_id: 'u1', plan_key: 'pro' } },
}));
check('subscription.* captures subscription id (data.id)', subEvt.subscriptionId === 'sub_abc');
check('subscription.* captures customer id (data.customer_id)', subEvt.customerId === 'ctm_xyz');
const txnEvt = getAdapter('paddle').parseEvent(JSON.stringify({
  event_id: 'evt_2', event_type: 'transaction.completed',
  data: { id: 'txn_1', subscription_id: 'sub_def', customer_id: 'ctm_111', items: [{ price: { id: 'pri_1' } }] },
}));
check('transaction.completed captures subscription id (data.subscription_id)', txnEvt.subscriptionId === 'sub_def');
check('transaction.completed captures customer id', txnEvt.customerId === 'ctm_111');
check('parser never throws on junk (ids null)', (() => {
  const e = getAdapter('paddle').parseEvent('not json');
  return e.subscriptionId === null && e.customerId === null;
})());

console.log('=== Neutral event shape carries the ids ===');
const types = read('src/shared/payments/types.ts');
check('ParsedSubscriptionEvent declares subscriptionId', /subscriptionId:\s*string \| null/.test(types));
check('ParsedSubscriptionEvent declares customerId', /customerId:\s*string \| null/.test(types));

console.log('=== Server REST client (sandbox/live base, gating, operations) ===');
check('sandbox base is sandbox-api.paddle.com', paddleApiBase(true) === 'https://sandbox-api.paddle.com');
check('live base is api.paddle.com', paddleApiBase(false) === 'https://api.paddle.com');
const cfgNoKey: ProviderConfig = { provider: 'paddle', apiKey: null, apiSecret: null, webhookSecret: null, clientToken: 'test_t', sandbox: true };
const cfgKey: ProviderConfig = { ...cfgNoKey, apiKey: 'pdl_sdbx_apikey_x' };
check('paddleServerReady false without an api key', paddleServerReady(cfgNoKey) === false);
check('paddleServerReady true with paddle + api key', paddleServerReady(cfgKey) === true);
const api = read('src/shared/payments/paddleApi.ts');
check('client exposes getSubscription', /export async function getSubscription\(/.test(api));
check('client exposes cancelSubscriptionAtPeriodEnd', /export async function cancelSubscriptionAtPeriodEnd\(/.test(api));
check('client exposes listSubscriptionInvoices', /export async function listSubscriptionInvoices\(/.test(api));
check('client exposes getInvoicePdfUrl', /export async function getInvoicePdfUrl\(/.test(api));
check('cancel is AT PERIOD END (next_billing_period)', /effective_from:\s*'next_billing_period'/.test(api));
check('client authorizes with the server api key (Bearer)', /Authorization: `Bearer \$\{cfg\.apiKey\}`/.test(api));
check('client never caches a billing response', /cache:\s*'no-store'/.test(api));

console.log('=== Webhook stores ids; plan write path unchanged ===');
const webhook = read('app/api/payments/webhook/[provider]/route.ts');
check('webhook stores ids via storeUserSubscriptionIds', /storeUserSubscriptionIds\(/.test(webhook));
check('webhook still reuses setUserPlan', /setUserPlan\(/.test(webhook));
check('webhook does NOT write subscription_plan directly', !/subscription_plan\s*:/.test(webhook));
const cfg = read('src/shared/payments/config.ts');
check('store helper writes only paddle id columns', /paddle_subscription_id\s*=/.test(cfg) && /paddle_customer_id\s*=/.test(cfg) && !/subscription_plan/.test(cfg.split('storeUserSubscriptionIds')[1] ?? ''));

console.log('=== API routes: session-guarded, server-side ===');
const routes = [
  'app/api/payments/subscription/route.ts',
  'app/api/payments/subscription/cancel/route.ts',
  'app/api/payments/invoices/route.ts',
  'app/api/payments/invoice/[id]/route.ts',
];
for (const r of routes) {
  const src = read(r);
  check(`route session-guarded: ${r}`, /getServerSession\(authOptions\)/.test(src) && /Unauthorized/.test(src));
  check(`route uses server paddle context: ${r}`, /loadUserPaddleContext\(/.test(src));
}
check('cancel route calls cancelSubscriptionAtPeriodEnd', /cancelSubscriptionAtPeriodEnd\(/.test(read('app/api/payments/subscription/cancel/route.ts')));
check('invoice route checks ownership before issuing a URL', /some\(\(inv\) => inv\.transactionId === id\)/.test(read('app/api/payments/invoice/[id]/route.ts')));

console.log('=== Dashboard panel: rendered, client-safe, no card form ===');
const dash = read('app/modeling/dashboard/page.tsx');
check('dashboard imports SubscriptionPanel', /import SubscriptionPanel from/.test(dash));
check('dashboard renders SubscriptionPanel', /<SubscriptionPanel\b/.test(dash));
const panel = read('src/hubs/modeling/components/SubscriptionPanel.tsx');
check('panel reads from our server routes', /\/api\/payments\/subscription/.test(panel) && /\/api\/payments\/invoices/.test(panel));
check('panel makes NO direct Paddle API call', !/paddle\.com/i.test(panel) && !/paddleApi/.test(panel));
check('panel never references an api key / secret', !/apiKey/i.test(panel) && !/api_secret/i.test(panel));
check('panel update-payment uses the hosted url (no card form)', /updatePaymentMethodUrl/.test(panel) && !/card number/i.test(panel) && !/<input/i.test(panel));
check('panel has a confirm step before cancel', /subscription-cancel-confirm/.test(panel) && /subscription-cancel-btn/.test(panel));
check('panel shows invoices list', /invoices-list/.test(panel) && /invoice-row/.test(panel));

console.log('=== Post-payment redirect ===');
const browser = read('src/shared/payments/paddleBrowser.ts');
check('opener fires onComplete on checkout.completed', /checkout\.completed/.test(browser) && /pendingComplete\?\.\(\)/.test(browser) && /onComplete\?:/.test(browser));
check('loaded does not count as paid (separate branch)', /checkout\.loaded/.test(browser));
const pricing = read('src/hubs/main/components/pricing/PricingExplorer.tsx');
check('pricing redirects into the app on completion', /onComplete:/.test(pricing) && /window\.location\.href = '\/dashboard'/.test(pricing));

console.log('=== Migration 176 (additive id columns) ===');
const mig = read('supabase/migrations/176_users_paddle_subscription.sql');
check('mig 176 adds paddle_subscription_id (IF NOT EXISTS)', /ADD COLUMN IF NOT EXISTS paddle_subscription_id text/.test(mig));
check('mig 176 adds paddle_customer_id (IF NOT EXISTS)', /ADD COLUMN IF NOT EXISTS paddle_customer_id\s+text/.test(mig));
check('mig 176 alters/drops nothing destructive', !/DROP\s+(TABLE|COLUMN)/i.test(mig));

console.log('=== No em dashes in new/edited files ===');
const files = [
  'src/shared/payments/types.ts', 'src/shared/payments/adapters/paddle.ts',
  'src/shared/payments/adapters/paypro.ts', 'src/shared/payments/config.ts',
  'src/shared/payments/paddleApi.ts', 'src/shared/payments/subscriptionContext.ts',
  'src/shared/payments/paddleBrowser.ts', 'src/hubs/modeling/components/SubscriptionPanel.tsx',
  'app/api/payments/webhook/[provider]/route.ts',
  'app/api/payments/subscription/route.ts', 'app/api/payments/subscription/cancel/route.ts',
  'app/api/payments/invoices/route.ts', 'app/api/payments/invoice/[id]/route.ts',
  'app/modeling/dashboard/page.tsx', 'src/hubs/main/components/pricing/PricingExplorer.tsx',
  'supabase/migrations/176_users_paddle_subscription.sql',
];
for (const f of files) check(`no em dash: ${f}`, !read(f).includes(EM));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
