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

console.log('=== Per-platform store (mig 177) + platform-keyed webhook ===');
const mig177 = read('supabase/migrations/177_user_platform_subscriptions.sql');
check('mig 177 creates user_platform_subscriptions PK (user_id, platform_slug)', /CREATE TABLE IF NOT EXISTS user_platform_subscriptions/.test(mig177) && /PRIMARY KEY \(user_id, platform_slug\)/.test(mig177));
check('mig 177 RLS enabled, no destructive drops', /ENABLE ROW LEVEL SECURITY/.test(mig177) && !/DROP\s+(TABLE|COLUMN)/i.test(mig177));
check('mig 177 backfills real-estate from the global columns', /INSERT INTO user_platform_subscriptions/.test(mig177) && /'real-estate'/.test(mig177));
const webhookSrc = read('app/api/payments/webhook/[provider]/route.ts');
check('webhook derives the platform from custom data', /event\.customDataPlatform \?\? PLATFORM/.test(webhookSrc));
check('webhook upserts the per-platform subscription', /storeUserPlatformSubscription\(/.test(webhookSrc));
check('paddle parseEvent captures custom-data platform', getAdapter('paddle').parseEvent(JSON.stringify({
  event_type: 'subscription.activated', event_id: 'e', data: { id: 'sub_1', custom_data: { platform: 'real-estate' } },
})).customDataPlatform === 'real-estate');
const ctxSrc = read('src/shared/payments/subscriptionContext.ts');
check('context is platform-scoped (reads per-platform table + fallback)', /user_platform_subscriptions/.test(ctxSrc) && /platform === DEFAULT_PAYMENTS_PLATFORM/.test(ctxSrc));
check('checkout passes the platform through (per-platform custom data)', /platform/.test(read('app/api/payments/checkout/route.ts')) && /req\.platform/.test(read('src/shared/payments/adapters/paddle.ts')));

console.log('=== API routes: session-guarded, server-side, platform-scoped ===');
const routes = [
  'app/api/payments/subscription/route.ts',
  'app/api/payments/subscription/cancel/route.ts',
  'app/api/payments/invoices/route.ts',
  'app/api/payments/invoice/[id]/route.ts',
  'app/api/payments/subscription/change-plan/route.ts',
];
for (const r of routes) {
  const src = read(r);
  check(`route session-guarded: ${r}`, /getServerSession\(authOptions\)/.test(src) && /Unauthorized/.test(src));
  check(`route uses server paddle context: ${r}`, /loadUserPaddleContext\(/.test(src));
  check(`route is platform-scoped: ${r}`, /platform/.test(src));
}
check('cancel route calls cancelSubscriptionAtPeriodEnd', /cancelSubscriptionAtPeriodEnd\(/.test(read('app/api/payments/subscription/cancel/route.ts')));
check('invoice route checks ownership before issuing a URL', /some\(\(inv\) => inv\.transactionId === id\)/.test(read('app/api/payments/invoice/[id]/route.ts')));

console.log('=== Upgrade / downgrade (server-side plan change) ===');
const api2 = read('src/shared/payments/paddleApi.ts');
check('paddleApi exposes changeSubscriptionPlan (PATCH + proration)', /export async function changeSubscriptionPlan\(/.test(api2) && /proration_billing_mode/.test(api2) && /method:\s*'PATCH'/.test(api2));
const changeRoute = read('app/api/payments/subscription/change-plan/route.ts');
check('change-plan resolves the target price id by interval', /planProviderPriceId\(/.test(changeRoute) && /targetInterval/.test(changeRoute));
check('change-plan accepts an interval (interval change supported)', /body\.interval === 'annual'/.test(changeRoute) && /body\.interval === 'monthly'/.test(changeRoute));
check('change-plan guards the same-plan no-op', /already_on_plan/.test(changeRoute));
check('change-plan does NOT write the plan itself (webhook syncs)', !/setUserPlan\(/.test(changeRoute));

console.log('=== Preview differential (no charge) + feature list + interval ===');
check('paddleApi exposes previewSubscriptionChange (PATCH /preview)', /export async function previewSubscriptionChange\(/.test(api2) && /\/preview`/.test(api2) && /update_summary/.test(api2));
const catalog = read('src/shared/entitlements/pricingCatalog.ts');
check('catalog exposes loadPlanFeatureList (catalog feature source)', /export async function loadPlanFeatureList\(/.test(catalog) && /visibleForCustomers\(/.test(catalog) && /comparisonCellText\(/.test(catalog));
const previewRoute = read('app/api/payments/subscription/preview-change/route.ts');
check('preview-change is session-guarded + platform context', /getServerSession\(authOptions\)/.test(previewRoute) && /loadUserPaddleContext\(/.test(previewRoute));
check('preview-change returns the target feature list + differential', /loadPlanFeatureList\(/.test(previewRoute) && /previewSubscriptionChange\(/.test(previewRoute) && /targetFeatures/.test(previewRoute) && /differential/.test(previewRoute));
check('preview-change PREVIEWS ONLY (never changes the plan)', !/changeSubscriptionPlan\(/.test(previewRoute));
check('preview-change supports an interval', /body\.interval === 'annual'/.test(previewRoute));
const panelP = read('src/hubs/modeling/components/SubscriptionPanel.tsx');
check('panel previews before confirming (feature list + differential)', /\/api\/payments\/subscription\/preview-change/.test(panelP) && /change-plan-features/.test(panelP) && /change-plan-differential/.test(panelP));
check('panel offers an interval toggle + interval-change action', /interval-\$\{iv\}/.test(panelP) && /'monthly', 'annual'/.test(panelP) && /switch-interval/.test(panelP));
check('panel shows charge vs credit from the preview', /You will be charged/.test(panelP) && /credit of/.test(panelP));

console.log('=== Billing tab + per-platform rendering, client-safe ===');
const dash = read('app/modeling/dashboard/page.tsx');
check('dashboard has a Billing nav item', /id:\s*'billing'/.test(dash));
check('dashboard renders BillingView in the billing view', /import BillingView from/.test(dash) && /<BillingView\b/.test(dash));
check('dashboard switches an in-page activeView', /activeView/.test(dash) && /setActiveView/.test(dash));
const billingView = read('src/hubs/modeling/components/BillingView.tsx');
check('BillingView is source-driven (maps platforms -> one panel each)', /platforms\.map\(/.test(billingView) && /<SubscriptionPanel\b/.test(billingView));
const panel = read('src/hubs/modeling/components/SubscriptionPanel.tsx');
check('panel is platform-scoped (platform prop + query)', /platform:\s*string/.test(panel) && /platform=\$\{encodeURIComponent\(platform\)\}/.test(panel));
check('panel reads from our server routes', /\/api\/payments\/subscription/.test(panel) && /\/api\/payments\/invoices/.test(panel));
check('panel makes NO direct Paddle API call', !/paddle\.com/i.test(panel) && !/paddleApi/.test(panel));
check('panel never references an api key / secret', !/apiKey/i.test(panel) && !/api_secret/i.test(panel));
check('panel update-payment uses the hosted url (no card form)', /updatePaymentMethodUrl/.test(panel) && !/card number/i.test(panel) && !/<input/i.test(panel));
check('panel has a confirm step before cancel', /subscription-cancel-confirm/.test(panel) && /subscription-cancel-btn/.test(panel));
check('panel has upgrade/downgrade with a confirm step', /change-plan-confirm/.test(panel) && /switch-to-/.test(panel) && /\/api\/payments\/subscription\/change-plan/.test(panel));
check('panel shows invoices list', /invoices-list/.test(panel) && /invoice-row/.test(panel));

console.log('=== Invoice in-dashboard viewer (no forced download) ===');
check('panel opens an in-dashboard viewer (iframe), not a new-tab download', /invoice-viewer/.test(panel) && /<iframe/.test(panel) && /invoice-view-btn/.test(panel));
check('viewer offers an optional Download button', /invoice-download-btn/.test(panel));
check('View PDF is a button (no forced download anchor)', !/View PDF &rarr;/.test(panel));

console.log('=== Post-payment redirect ===');
const browser = read('src/shared/payments/paddleBrowser.ts');
check('opener fires onComplete on checkout.completed', /checkout\.completed/.test(browser) && /pendingComplete\?\.\(\)/.test(browser) && /onComplete\?:/.test(browser));
check('loaded does not count as paid (separate branch)', /checkout\.loaded/.test(browser));
const pricing = read('src/hubs/main/components/pricing/PricingExplorer.tsx');
check('pricing redirects into the app (billing tab) on completion', /onComplete:/.test(pricing) && /window\.location\.href = '\/dashboard#billing'/.test(pricing));

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
  'supabase/migrations/177_user_platform_subscriptions.sql',
  'src/hubs/modeling/components/BillingView.tsx',
  'app/api/payments/subscription/change-plan/route.ts',
  'app/api/payments/subscription/preview-change/route.ts',
  'app/api/payments/checkout/route.ts',
  'src/shared/entitlements/pricingCatalog.ts',
];
for (const f of files) check(`no em dash: ${f}`, !read(f).includes(EM));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
