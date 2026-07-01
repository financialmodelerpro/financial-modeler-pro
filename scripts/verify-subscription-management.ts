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
import { classifyPlanChange, effectiveMonthlyPrice, classifyPlanOrIntervalChange, isLivePaddleSubscription, type PlatformPlanOption, type PlatformSubscriptionRow } from '../src/shared/payments/config';
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

console.log('=== Upgrade immediate / downgrade next-cycle timing rule ===');
// Pure classification: by monthly-equivalent effective price (interval-aware).
check('effectiveMonthlyPrice normalizes annual to /12', effectiveMonthlyPrice({ price_monthly: 50, price_annual: 480 }, 'annual') === 40);
check('classify higher target -> upgrade', classifyPlanChange(40, 80) === 'upgrade');
check('classify lower target -> downgrade', classifyPlanChange(80, 40) === 'downgrade');
check('classify equal -> lateral', classifyPlanChange(50, 50) === 'lateral');
check('classify unknown price -> upgrade (never silently defer)', classifyPlanChange(null, 40) === 'upgrade');
check('interval-aware: annual Pro (40/mo) below monthly Firm (80) -> downgrade', classifyPlanChange(80, effectiveMonthlyPrice({ price_monthly: 50, price_annual: 480 }, 'annual')) === 'downgrade');
const mig178 = read('supabase/migrations/178_scheduled_plan_change.sql');
check('mig 178 adds scheduled_* columns (additive)', /ADD COLUMN IF NOT EXISTS scheduled_plan_key/.test(mig178) && /ADD COLUMN IF NOT EXISTS scheduled_price_id/.test(mig178) && /ADD COLUMN IF NOT EXISTS scheduled_effective_at/.test(mig178) && !/DROP\s+(TABLE|COLUMN)/i.test(mig178));
const previewR = read('app/api/payments/subscription/preview-change/route.ts');
check('preview-change classifies + returns changeType', /classifyPlanOrIntervalChange\(/.test(previewR) && /changeType/.test(previewR));
check('preview-change downgrade = no charge + effective date', /changeType === 'downgrade'/.test(previewR) && /differential: null/.test(previewR) && /effectiveAt/.test(previewR));
const changeR = read('app/api/payments/subscription/change-plan/route.ts');
check('change-plan defers a downgrade (schedules, no Paddle call)', /changeType === 'downgrade'/.test(changeR) && /storeScheduledChange\(/.test(changeR));
check('change-plan upgrade stays immediate + clears any schedule', /changeSubscriptionPlan\(/.test(changeR) && /clearScheduledChange\(/.test(changeR));
check('change-plan still does NOT write the plan (webhook syncs)', !/setUserPlan\(/.test(changeR));
const subR = read('app/api/payments/subscription/route.ts');
check('subscription route surfaces the scheduled change', /scheduledChange/.test(subR));
const cancelSchedR = read('app/api/payments/subscription/cancel-scheduled-change/route.ts');
check('cancel-scheduled-change is session-guarded + clears the schedule', /getServerSession\(authOptions\)/.test(cancelSchedR) && /clearScheduledChange\(/.test(cancelSchedR));
const cronR = read('app/api/cron/apply-scheduled-changes/route.ts');
check('apply-scheduled worker is CRON_SECRET-guarded', /Bearer \$\{process\.env\.CRON_SECRET\}/.test(cronR));
check('apply-scheduled worker applies due downgrades via Paddle', /scheduled_effective_at/.test(cronR) && /changeSubscriptionPlan\(/.test(cronR) && /clearScheduledChange\(/.test(cronR));
check('panel states upgrade-immediate + downgrade-next-cycle timing', /timing-downgrade/.test(panelP) && /timing-upgrade/.test(panelP) && /Takes effect on/.test(panelP) && /Takes effect immediately/.test(panelP));
check('panel shows a scheduled-downgrade notice + cancel action', /scheduled-change-notice/.test(panelP) && /cancel-scheduled-change/.test(panelP) && /Cancel scheduled change/.test(panelP));
check('panel handles applied:scheduled (no immediate change)', /res\.applied === 'scheduled'/.test(panelP));

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

console.log('=== Single source of truth + manual plans + expiry + interval fix ===');
// Interval classification (bug b): same-plan interval change is 'interval', not downgrade.
const vplans: PlatformPlanOption[] = [
  { plan_key: 'pro', label: 'Pro', display_order: 1, paddle_price_id_monthly: 'pm', paddle_price_id_annual: 'pa', paypro_product_id: null, price_monthly: 50, price_annual: 480, currency: 'USD' },
  { plan_key: 'firm', label: 'Firm', display_order: 2, paddle_price_id_monthly: 'fm', paddle_price_id_annual: 'fa', paypro_product_id: null, price_monthly: 100, price_annual: 960, currency: 'USD' },
];
check('same-plan monthly->annual is an INTERVAL change (not downgrade)', classifyPlanOrIntervalChange('pro', 'monthly', 'pro', 'annual', vplans) === 'interval');
check('same-plan annual->monthly is an INTERVAL change', classifyPlanOrIntervalChange('firm', 'annual', 'firm', 'monthly', vplans) === 'interval');
check('tier compared at single interval: pro->firm = upgrade (even annual target)', classifyPlanOrIntervalChange('pro', 'monthly', 'firm', 'annual', vplans) === 'upgrade');
check('tier: firm->pro = downgrade (annual discount does not mask it)', classifyPlanOrIntervalChange('firm', 'monthly', 'pro', 'annual', vplans) === 'downgrade');
// Paddle-billed block (pure).
const paddleRow: PlatformSubscriptionRow = { plan_key: 'firm', source: 'paddle', status: 'active', paddle_subscription_id: 'sub_1', paddle_customer_id: 'ctm', started_at: null, current_period_end: null, expires_at: null, amount_minor: null, currency: null, note: null };
const manualRow: PlatformSubscriptionRow = { ...paddleRow, source: 'manual', paddle_subscription_id: null };
const canceledRow: PlatformSubscriptionRow = { ...paddleRow, status: 'canceled' };
check('isLivePaddleSubscription true for a live paddle row', isLivePaddleSubscription(paddleRow) === true);
check('isLivePaddleSubscription false for a manual row', isLivePaddleSubscription(manualRow) === false);
check('isLivePaddleSubscription false for a canceled paddle row', isLivePaddleSubscription(canceledRow) === false);
check('isLivePaddleSubscription false for no row', isLivePaddleSubscription(null) === false);
// mig 179.
const mig179 = read('supabase/migrations/179_manual_subscriptions.sql');
check('mig 179 adds source/status/started_at/expires_at/amount (additive)', /ADD COLUMN IF NOT EXISTS source/.test(mig179) && /ADD COLUMN IF NOT EXISTS expires_at/.test(mig179) && /ADD COLUMN IF NOT EXISTS amount_minor/.test(mig179) && !/DROP\s+(TABLE|COLUMN)/i.test(mig179));
// Convergence: setUserPlan upserts the per-platform row on the manual path.
const sup = read('src/shared/entitlements/setUserPlan.ts');
check('setUserPlan converges on the per-platform row (manual upsert)', /upsertManualSubscription\(/.test(sup) && /subscription\?\.source === 'manual'/.test(sup));
// Gate honors expires_at (additive only).
const gateSrc = read('src/shared/entitlements/gate.ts');
check('gate adds planExpired (additive, mirrors trial expiry)', /planExpired\?: boolean/.test(gateSrc) && /input\.trialExpired \|\| \(input\.planExpired/.test(gateSrc));
const resolveSrc = read('src/shared/entitlements/resolveUser.ts');
check('resolveUser reads expires_at + passes planExpired', /expires_at/.test(resolveSrc) && /planExpired/.test(resolveSrc));
check('gate change is ADDITIVE (admin bypass + none still present)', /input\.isAdmin\) return wholesaleGate/.test(gateSrc) && /isNonePlan\(input\.planKey\)/.test(gateSrc));
// Admin plan route blocks Paddle-billed users + accepts manual fields.
const adminPlan = read('app/api/admin/entitlements/user/plan/route.ts');
check('admin plan route blocks a Paddle-billed user', /isLivePaddleSubscription\(/.test(adminPlan) && /paddle_billed/.test(adminPlan));
check('admin plan route assigns manual (source manual + dates + amount)', /source: 'manual'/.test(adminPlan) && /expiresAt/.test(adminPlan) && /amountMinor/.test(adminPlan));
// Admin GET surfaces subscription dates + revenue.
const adminGet = read('app/api/admin/entitlements/user/route.ts');
check('admin user GET returns subscription + revenue', /subscription/.test(adminGet) && /revenue/.test(adminGet) && /listSubscriptionInvoices\(/.test(adminGet));
// Manual billing panel branch (no Paddle actions).
check('billing panel branches on source manual (no Paddle actions)', /sub\.source === 'manual'/.test(panelP) && /Managed by your team/.test(panelP) && /manual-expires/.test(panelP));
check('subscription route returns a manual subscription branch', /ctx\.state === 'manual'/.test(read('app/api/payments/subscription/route.ts')) && /source: 'manual'/.test(read('app/api/payments/subscription/route.ts')));
// Panel interval copy (bug b).
check('panel labels an interval change (not downgrade)', /timing-interval/.test(panelP) && /Switch to \$\{intervalWord\(pendingChange\.interval\)\} billing/.test(panelP));
// Admin panel shows dates + revenue.
const adminPanel = read('src/components/admin/UserAccessPanel.tsx');
check('admin panel shows subscription dates + revenue + manual assign', /subscription-card/.test(adminPanel) && /revenue-card/.test(adminPanel) && /assign-manual-plan/.test(adminPanel) && /paddle-billed-block/.test(adminPanel));

console.log('=== Revenue ledger + convert-to-manual (mig 180) ===');
const mig180 = read('supabase/migrations/180_payment_ledger_and_convert.sql');
check('mig 180 creates payment_transactions ledger + unique external id', /CREATE TABLE IF NOT EXISTS payment_transactions/.test(mig180) && /uq_payment_transactions_external/.test(mig180) && /ENABLE ROW LEVEL SECURITY/.test(mig180));
check('mig 180 adds scheduled_to_manual conversion columns', /scheduled_to_manual/.test(mig180) && /scheduled_manual_plan_key/.test(mig180) && !/DROP\s+(TABLE|COLUMN)/i.test(mig180));
// Paddle adapter captures the transaction amount for the ledger.
const txnEvt2 = getAdapter('paddle').parseEvent(JSON.stringify({
  event_type: 'transaction.completed', event_id: 'e', data: { id: 'txn_9', subscription_id: 'sub', customer_id: 'ctm', details: { totals: { grand_total: '4900', currency_code: 'USD' } }, items: [{ price: { id: 'pri' } }] },
}));
check('paddle parseEvent captures the transaction id + amount', txnEvt2.transactionId === 'txn_9' && txnEvt2.transactionAmountMinor === 4900 && txnEvt2.transactionCurrency === 'USD');
check('non-transaction event carries no txn amount', getAdapter('paddle').parseEvent(JSON.stringify({ event_type: 'subscription.activated', event_id: 'e', data: { id: 'sub' } })).transactionAmountMinor === null);
// Webhook records the ledger + applies a pending conversion on cancel.
const wh = read('app/api/payments/webhook/[provider]/route.ts');
check('webhook records the completed transaction to the ledger', /recordPaymentTransaction\(/.test(wh) && /event\.transactionId/.test(wh));
check('webhook applies a scheduled manual conversion on cancel (not baseline)', /loadScheduledManualConversion\(/.test(wh) && /applyScheduledManualConversion\(/.test(wh));
// Shared conversion applier reuses setUserPlan (no duplicate plan logic).
const mc = read('src/shared/payments/manualConversion.ts');
check('applyScheduledManualConversion reuses setUserPlan + logs + clears', /setUserPlan\(/.test(mc) && /recordPaymentTransaction\(/.test(mc) && /clearScheduledManualConversion\(/.test(mc));
// Convert route: period-end default + immediate, reuses cancel mechanisms.
const conv = read('app/api/admin/subscription/convert-to-manual/route.ts');
check('convert route is admin-guarded', /role\?: string \}\)\.role !== 'admin'/.test(conv));
check('convert route requires a live Paddle sub', /isLivePaddleSubscription\(/.test(conv));
check('convert period-end: cancel at period end + schedule manual', /cancelSubscriptionAtPeriodEnd\(/.test(conv) && /storeScheduledManualConversion\(/.test(conv));
check('convert immediate: cancel now + setUserPlan manual', /cancelSubscriptionNow\(/.test(conv) && /source: 'manual'/.test(conv));
check('convert route shows the paid-through date', /paidThrough/.test(conv) && /currentPeriodEndsAt/.test(conv));
// B fix: an already-canceled / no-active-period sub must NOT be canceled again.
check('convert detects already-canceled / no active period', /alreadyInactive/.test(conv) && /det\.data\.canceled/.test(conv));
check('convert assigns manual directly when already canceled (no Paddle cancel)', /if \(alreadyInactive\) \{\s*\n\s*return await assignManualNow\(\)/.test(conv));
check('convert tolerates a when_canceled race (recovers, no 502)', /isAlreadyCanceledError/.test(conv) && /when\[_ \]\?canceled/.test(conv));
check('convert manual path is the single source (setUserPlan source manual)', /assignManualNow\(\)/.test(conv) && /source: 'manual'/.test(conv));
// B fix: the webhook baseline drop must not leave a live-looking Paddle row.
const whB = read('app/api/payments/webhook/[provider]/route.ts');
check('baseline drop clears the dead Paddle ids (no masquerade)', /clearPaddleSubscriptionIds\(sb, userId, eventPlatform\)/.test(whB));
check('clearPaddleSubscriptionIds nulls only the id columns', /export async function clearPaddleSubscriptionIds\(/.test(read('src/shared/payments/config.ts')) && /paddle_subscription_id: null, paddle_customer_id: null/.test(read('src/shared/payments/config.ts')));
check('paddleApi adds cancelSubscriptionNow (effective_from immediately)', /export async function cancelSubscriptionNow\(/.test(api2) && /effective_from: 'immediately'/.test(api2));
// Cron backstop for conversions.
check('cron applies due conversions as a backstop', /scheduled_to_manual/.test(cronR) && /applyScheduledManualConversion\(/.test(cronR));
// Revenue page + API.
const revApi = read('app/api/admin/revenue/route.ts');
check('revenue API admin-guarded + aggregates the ledger', /role !== 'admin'/.test(revApi) && /aggregateRevenue\(/.test(revApi));
const revPage = read('app/admin/revenue/page.tsx');
check('revenue page: total + paddle/manual split + by-plan + periods', /revenue-total/.test(revPage) && /revenue-paddle/.test(revPage) && /revenue-manual/.test(revPage) && /revenue-by-plan/.test(revPage) && /period-\$\{k\}/.test(revPage) && /periodBtn\('month'/.test(revPage) && /periodBtn\('year'/.test(revPage) && /custom-range/.test(revPage));
check('revenue marks the Paddle portion reconcilable', /reconcilable/i.test(revPage));
const nav = read('src/components/admin/CmsAdminNav.tsx');
check('admin nav has a Revenue link', /\/admin\/revenue/.test(nav));
// Admin panel convert UI (period-end default + immediate warning + paid-through).
check('admin panel has convert-to-manual (period-end + immediate warn + paid-through)', /convert-to-manual/.test(adminPanel) && /convert-period-end/.test(adminPanel) && /convert-immediate-warn/.test(adminPanel) && /paid-through/.test(adminPanel));
// Manual assignment logs revenue.
check('admin manual assign logs revenue to the ledger', /recordPaymentTransaction\(/.test(adminPlan));

console.log('=== Migration 176 (additive id columns) ===');
const mig = read('supabase/migrations/176_users_paddle_subscription.sql');
check('mig 176 adds paddle_subscription_id (IF NOT EXISTS)', /ADD COLUMN IF NOT EXISTS paddle_subscription_id text/.test(mig));
check('mig 176 adds paddle_customer_id (IF NOT EXISTS)', /ADD COLUMN IF NOT EXISTS paddle_customer_id\s+text/.test(mig));
check('mig 176 alters/drops nothing destructive', !/DROP\s+(TABLE|COLUMN)/i.test(mig));

// ── Store-B convergence on EVERY plan write + trial-path Paddle guard ─────────
console.log('=== Store-B convergence (setUserPlan) + trial Paddle guard ===');
const setPlanSrc = read('src/shared/entitlements/setUserPlan.ts');
const cfgSrc = read('src/shared/payments/config.ts');

// 1. setUserPlan converges store B on BOTH paths: full upsert for manual, partial
//    (UPDATE-only) sync for every other caller (trial shortcut, self-serve,
//    approval, webhook), so A and B never diverge from any path.
check('setUserPlan keeps the full manual upsert (source/dates/amount)', /upsertManualSubscription\(/.test(setPlanSrc));
check('setUserPlan converges store B on the NON-manual path too', /else\s*\{[\s\S]*syncPlatformSubscriptionFields\(/.test(setPlanSrc));
check('setUserPlan partial converge sends plan_key + status', /syncPlatformSubscriptionFields\(sb,\s*userId,\s*platform,\s*\{\s*planKey,\s*status\s*\}\)/.test(setPlanSrc));

// 2. syncPlatformSubscriptionFields is UPDATE-only (never upsert/insert) and its
//    patch never touches webhook-owned metadata (source / paddle ids / dates).
const syncFn = cfgSrc.slice(cfgSrc.indexOf('export async function syncPlatformSubscriptionFields'));
const syncBody = syncFn.slice(0, syncFn.indexOf('\n}\n') + 2);
check('sync is UPDATE-only (no upsert/insert that would fabricate a row)', /\.update\(patch\)/.test(syncBody) && !/\.upsert\(|\.insert\(/.test(syncBody));
check('sync patch never writes source (the .eq filter is allowed)', !/patch\.source|source:/.test(syncBody));
check('sync patch never writes paddle ids', !/paddle_subscription_id|paddle_customer_id/.test(syncBody));
check('sync patch never writes Paddle period/dates', !/current_period_end|expires_at|started_at/.test(syncBody));
check('sync supports manualOnly (status seam, never clobbers Paddle status)', /opts\?\.manualOnly[\s\S]*\.eq\('source',\s*'manual'\)/.test(syncBody));

// 3. The shared block message + guard helper exist and are reused (single source).
check('shared PADDLE_BILLED_BLOCK_MESSAGE constant exists', /export const PADDLE_BILLED_BLOCK_MESSAGE\s*=/.test(cfgSrc));
check('isUserLivePaddle helper wraps the row read + pure check', /export async function isUserLivePaddle\([\s\S]*isLivePaddleSubscription\(row\)/.test(cfgSrc));

// 4. EVERY trial path applies the live-Paddle guard (no silent app-vs-Paddle drift).
const trialShortcut = read('app/api/admin/entitlements/user/trial/route.ts');
const trialReq = read('src/shared/entitlements/trialRequests.ts');
const trialApprove = read('app/api/admin/trial-requests/route.ts');
const planRoute = read('app/api/admin/entitlements/user/plan/route.ts');
check('admin trial shortcut guards on isUserLivePaddle', /isUserLivePaddle\(/.test(trialShortcut) && /paddle_billed/.test(trialShortcut));
check('self-serve startTrialForUser guards on isUserLivePaddle', /isUserLivePaddle\(/.test(trialReq) && /paddle_billed/.test(trialReq));
check('trial-request approve guards on isUserLivePaddle', /isUserLivePaddle\(/.test(trialApprove) && /paddle_billed/.test(trialApprove));
check('plan route reuses the shared block message (single source)', /PADDLE_BILLED_BLOCK_MESSAGE/.test(planRoute));
check('self-serve trial route maps paddle_billed -> 409', /code === 'paddle_billed' \? 409/.test(read('app/api/refm/trial/route.ts')));

// 5. The /admin/users status dropdown converges store B status, manual-only.
const usersRoute = read('app/api/admin/users/route.ts');
check('admin status dropdown syncs store B status (manualOnly)', /syncPlatformSubscriptionFields\(sb,\s*id,\s*'real-estate',\s*\{\s*status:\s*newStatus\s*\},\s*\{\s*manualOnly:\s*true\s*\}\)/.test(usersRoute));

// 6. Pure guard logic: a manual row and a canceled paddle row are NOT "live".
const liveRow: PlatformSubscriptionRow = { plan_key: 'firm', source: 'paddle', status: 'active', paddle_subscription_id: 'sub_x', paddle_customer_id: 'ctm', started_at: null, current_period_end: null, expires_at: null, amount_minor: null, currency: null, note: null };
check('live paddle row IS live (guard fires)', isLivePaddleSubscription(liveRow) === true);
check('manual row is NOT live (guard does not fire)', isLivePaddleSubscription({ ...liveRow, source: 'manual' }) === false);
check('canceled paddle row is NOT live', isLivePaddleSubscription({ ...liveRow, status: 'canceled' }) === false);
check('no paddle id is NOT live', isLivePaddleSubscription({ ...liveRow, paddle_subscription_id: null }) === false);

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
  'app/api/payments/subscription/cancel-scheduled-change/route.ts',
  'app/api/cron/apply-scheduled-changes/route.ts',
  'app/api/payments/checkout/route.ts',
  'src/shared/entitlements/pricingCatalog.ts',
  'src/shared/payments/subscriptionContext.ts',
  'supabase/migrations/178_scheduled_plan_change.sql',
  'supabase/migrations/179_manual_subscriptions.sql',
  'src/shared/entitlements/setUserPlan.ts',
  'src/shared/entitlements/gate.ts',
  'src/shared/entitlements/resolveUser.ts',
  'app/api/admin/entitlements/user/plan/route.ts',
  'app/api/admin/entitlements/user/route.ts',
  'src/components/admin/UserAccessPanel.tsx',
  'supabase/migrations/180_payment_ledger_and_convert.sql',
  'src/shared/payments/manualConversion.ts',
  'app/api/admin/subscription/convert-to-manual/route.ts',
  'app/api/admin/revenue/route.ts',
  'app/admin/revenue/page.tsx',
  'app/api/admin/entitlements/user/trial/route.ts',
  'src/shared/entitlements/trialRequests.ts',
  'app/api/admin/trial-requests/route.ts',
  'app/api/refm/trial/route.ts',
  'app/api/admin/users/route.ts',
];
for (const f of files) check(`no em dash: ${f}`, !read(f).includes(EM));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
