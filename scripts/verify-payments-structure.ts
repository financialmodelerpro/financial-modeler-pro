/**
 * verify-payments-structure.ts
 *
 * Proves the payment layer without any LIVE provider network calls:
 *  - the registry exposes paddle + paypro; paddle is IMPLEMENTED, paypro is a STUB;
 *  - paddle createCheckout returns an 'open_overlay' instruction carrying ONLY
 *    the publishable client token (no secret), and fails GRACEFULLY (no throw)
 *    when the client token or the price id is missing; paypro stays not_configured;
 *  - the Paddle webhook signature scheme verifies (ts:body HMAC under the secret):
 *    a valid signature passes, a tampered body / wrong secret / missing header fail;
 *  - parseEvent maps Paddle events to the neutral shape and NEVER throws on junk;
 *  - the masked config exposes the publishable client token but NO raw secret;
 *  - the plan provider-id pick + baseline are correct;
 *  - the webhook route REUSES the shared setUserPlan (no duplicate write),
 *    verifies the signature before parsing, is idempotent, and prefers the
 *    custom-data user ref; the checkout route returns the placeholder for none.
 *
 * Run: npx tsx scripts/verify-payments-structure.ts
 */
import fs from 'fs';
import path from 'path';
import { allAdapters, getAdapter, PAYMENT_PROVIDERS } from '../src/shared/payments/registry';
import { hmacSha256Hex, verifyPaddleSignature } from '../src/shared/payments/signature';
import {
  maskPaymentSettings, defaultPaymentSettings, planProviderPriceId, providerConfigFrom,
  BASELINE_PLAN_KEY, type PaymentSettingsRow, type PlanProviderIds,
} from '../src/shared/payments/config';
import type { ProviderConfig } from '../src/shared/payments/types';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

console.log('=== Adapter interface (paddle implemented, paypro stub) ===');
const adapters = allAdapters();
check('registry exposes paddle + paypro', PAYMENT_PROVIDERS.join(',') === 'paddle,paypro' && adapters.length === 2);
check('paddle is implemented', getAdapter('paddle').implemented === true);
check('paypro is still a stub', getAdapter('paypro').implemented === false);
check('paypro parseEvent returns unknown', getAdapter('paypro').parseEvent('{}').type === 'unknown');
check('paddle parseEvent never throws on junk (unknown)', getAdapter('paddle').parseEvent('not json').type === 'unknown');

(async () => {
  const cfg: ProviderConfig = { provider: 'paddle', apiKey: 'k', apiSecret: 's', webhookSecret: 'whsec', clientToken: 'test_tok', sandbox: true };

  console.log('=== Paddle checkout (overlay instruction, graceful failures) ===');
  const okRes = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pri_123', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' }, cfg,
  );
  check('paddle checkout returns open_overlay (ok)', okRes.ok === true && okRes.status === 'open_overlay');
  check('paddle checkout carries the publishable client token + price id', okRes.clientToken === 'test_tok' && okRes.priceId === 'pri_123');
  check('paddle checkout passes custom data (user_id + plan_key) for webhook mapping', okRes.customData?.user_id === 'u1' && okRes.customData?.plan_key === 'pro');
  check('paddle checkout result leaks NO secret', !JSON.stringify(okRes).includes('whsec') && !JSON.stringify(okRes).includes('"k"') && !JSON.stringify(okRes).includes('apiSecret'));
  const noPrice = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: null, userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' }, cfg,
  );
  check('paddle checkout fails gracefully on missing price id (no throw)', noPrice.ok === false && noPrice.status === 'error');
  const noToken = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pri_123', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' }, { ...cfg, clientToken: null },
  );
  check('paddle checkout fails gracefully on missing client token (no throw)', noToken.ok === false && noToken.status === 'error');
  // Environment guard: a live token under sandbox (or test token under live)
  // fails up front with an actionable message rather than a generic overlay error.
  const liveTokenSandbox = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pri_123', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' },
    { ...cfg, clientToken: 'live_abc', sandbox: true },
  );
  check('paddle checkout flags a LIVE token used in sandbox mode (error)', liveTokenSandbox.ok === false && liveTokenSandbox.status === 'error' && /sandbox/i.test(liveTokenSandbox.message));
  const testTokenLive = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pri_123', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' },
    { ...cfg, clientToken: 'test_abc', sandbox: false },
  );
  check('paddle checkout flags a TEST token used in live mode (error)', testTokenLive.ok === false && testTokenLive.status === 'error' && /live/i.test(testTokenLive.message));
  const matchedSandbox = await getAdapter('paddle').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pri_123', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' },
    { ...cfg, clientToken: 'test_ok', sandbox: true },
  );
  check('paddle checkout opens when token env matches sandbox flag', matchedSandbox.ok === true && matchedSandbox.status === 'open_overlay');
  const ppRes = await getAdapter('paypro').createCheckout(
    { planKey: 'pro', interval: 'monthly', providerPriceId: 'pp1', userId: 'u1', userEmail: 'a@b.com', platform: 'real-estate' }, { ...cfg, provider: 'paypro' },
  );
  check('paypro checkout returns not_configured (still stubbed)', ppRes.ok === false && ppRes.status === 'not_configured');

  console.log('=== Paddle webhook signature (ts:body HMAC) ===');
  const body = JSON.stringify({ event_type: 'subscription.activated', event_id: 'evt_1' });
  const secret = 'pdl_ntfset_test';
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = hmacSha256Hex(`${ts}:${body}`, secret);
  const header = `ts=${ts};h1=${h1}`;
  const withSecret: ProviderConfig = { ...cfg, webhookSecret: secret };
  check('valid Paddle signature passes (adapter, 300s tolerance)', getAdapter('paddle').verifyWebhook(body, header, withSecret).valid === true);
  check('tampered body fails', getAdapter('paddle').verifyWebhook(body + 'x', header, withSecret).valid === false);
  check('wrong secret fails', getAdapter('paddle').verifyWebhook(body, header, { ...cfg, webhookSecret: 'other' }).valid === false);
  check('missing header fails', getAdapter('paddle').verifyWebhook(body, null, withSecret).valid === false);
  check('missing secret fails', getAdapter('paddle').verifyWebhook(body, header, { ...cfg, webhookSecret: null }).valid === false);
  // Freshness: an old timestamp is rejected when tolerance is enforced.
  const oldTs = '1600000000';
  const oldHeader = `ts=${oldTs};h1=${hmacSha256Hex(`${oldTs}:${body}`, secret)}`;
  check('stale timestamp rejected under tolerance', verifyPaddleSignature(body, oldHeader, secret, 300).valid === false);
  check('stale timestamp accepted when tolerance disabled (HMAC still valid)', verifyPaddleSignature(body, oldHeader, secret, 0).valid === true);

  console.log('=== Paddle parseEvent (neutral mapping, idempotency id) ===');
  const evt = getAdapter('paddle').parseEvent(JSON.stringify({
    event_id: 'evt_abc', event_type: 'subscription.activated',
    data: { items: [{ price: { id: 'pri_x' } }], custom_data: { user_id: 'u-9', plan_key: 'pro' }, customer: { email: 'Buyer@Example.com' } },
  }));
  check('activated event mapped', evt.type === 'activated');
  check('event id captured (idempotency)', evt.eventId === 'evt_abc');
  check('price id captured', evt.providerPriceOrProductId === 'pri_x');
  check('custom-data user ref + plan key captured', evt.userRef === 'u-9' && evt.customDataPlanKey === 'pro');
  check('customer email captured', evt.customerEmail === 'Buyer@Example.com');
  check('canceled event maps to cancelled', getAdapter('paddle').parseEvent(JSON.stringify({ event_type: 'subscription.canceled', event_id: 'e2', data: {} })).type === 'cancelled');
  check('unknown event type maps to unknown', getAdapter('paddle').parseEvent(JSON.stringify({ event_type: 'transaction.created', event_id: 'e3', data: {} })).type === 'unknown');

  console.log('=== Config masking (publishable token shown, secrets never reach a client) ===');
  const row: PaymentSettingsRow = {
    ...defaultPaymentSettings('real-estate'),
    active_provider: 'paddle',
    paddle_api_key: 'KEY_SECRET_VALUE', paddle_api_secret: 'API_SECRET_VALUE', paddle_webhook_secret: 'WEBHOOK_SECRET_VALUE',
    paddle_client_token: 'test_PUBLISHABLE', paddle_sandbox: true,
  };
  const masked = maskPaymentSettings(row);
  const maskedJson = JSON.stringify(masked);
  check('mask carries active_provider', masked.active_provider === 'paddle');
  check('mask reports paddle credentials set', masked.paddle.has_api_key && masked.paddle.has_api_secret && masked.paddle.has_webhook_secret);
  check('mask exposes the publishable client token', masked.paddle.client_token === 'test_PUBLISHABLE');
  check('mask preserves sandbox flag', masked.paddle.sandbox === true);
  check('mask contains NO raw secret', !maskedJson.includes('KEY_SECRET_VALUE') && !maskedJson.includes('API_SECRET_VALUE') && !maskedJson.includes('WEBHOOK_SECRET_VALUE'));

  console.log('=== Provider price id pick + config + baseline ===');
  const plan: PlanProviderIds = { plan_key: 'pro', paddle_price_id_monthly: 'pmon', paddle_price_id_annual: 'pann', paypro_product_id: 'pp1' };
  check('paddle monthly id', planProviderPriceId(plan, 'paddle', 'monthly') === 'pmon');
  check('paddle annual id', planProviderPriceId(plan, 'paddle', 'annual') === 'pann');
  check('providerConfigFrom maps the paddle client token', providerConfigFrom(row, 'paddle').clientToken === 'test_PUBLISHABLE');
  check('providerConfigFrom paypro has no client token', providerConfigFrom(row, 'paypro').clientToken === null);
  check('default active provider is none', defaultPaymentSettings('real-estate').active_provider === 'none');
  check('baseline plan key defined', typeof BASELINE_PLAN_KEY === 'string' && BASELINE_PLAN_KEY.length > 0);

  console.log('=== Route structure (reuse setUserPlan; verify before parse; idempotent) ===');
  const webhook = read('app/api/payments/webhook/[provider]/route.ts');
  check('webhook imports shared setUserPlan', /import\s*\{[^}]*setUserPlan[^}]*\}\s*from\s*'@\/src\/shared\/entitlements\/setUserPlan'/.test(webhook));
  check('webhook calls setUserPlan', /setUserPlan\(/.test(webhook));
  check('webhook does NOT duplicate the subscription_plan write', !/\.update\(\s*\{[^}]*subscription_plan/.test(webhook) && !/subscription_plan\s*:/.test(webhook));
  check('webhook verifies signature before parseEvent', webhook.indexOf('verifyWebhook(') < webhook.indexOf('parseEvent('));
  check('webhook is idempotent (checks + records event id)', /wasWebhookEventProcessed\(/.test(webhook) && /recordWebhookEvent\(/.test(webhook));
  check('webhook prefers custom-data user ref, falls back to email', /event\.userRef/.test(webhook) && /event\.customerEmail/.test(webhook));
  check('webhook drops to baseline on cancel', /BASELINE_PLAN_KEY/.test(webhook));

  const checkout = read('app/api/payments/checkout/route.ts');
  check('checkout returns placeholder when provider none', /active_provider === 'none'/.test(checkout) && /status:\s*'placeholder'/.test(checkout));
  check('checkout reads provider price id from plan', /planProviderPriceId\(/.test(checkout));
  check('checkout never sets a plan (does not call setUserPlan)', !/setUserPlan\(/.test(checkout));

  const adminCfg = read('app/api/admin/payments/config/route.ts');
  check('admin config GET returns masked view', /maskPaymentSettings\(/.test(adminCfg));
  check('admin config never selects raw secrets into a client response', !/config:\s*row/.test(adminCfg));

  const browser = read('src/shared/payments/paddleBrowser.ts');
  check('browser helper loads Paddle.js v2 + sets sandbox env', /cdn\.paddle\.com\/paddle\/v2\/paddle\.js/.test(browser) && /Environment(\?)?\.set\('sandbox'\)/.test(browser) && /Checkout\.open\(/.test(browser));

  console.log('=== No em dashes in payment files ===');
  const files = [
    'src/shared/payments/types.ts', 'src/shared/payments/signature.ts',
    'src/shared/payments/registry.ts', 'src/shared/payments/config.ts',
    'src/shared/payments/adapters/paddle.ts', 'src/shared/payments/adapters/paypro.ts',
    'src/shared/payments/paddleBrowser.ts', 'src/shared/payments/paddleEnv.ts',
    'app/api/payments/checkout/route.ts', 'app/api/payments/webhook/[provider]/route.ts',
    'app/api/admin/payments/config/route.ts', 'app/admin/payments/page.tsx',
  ];
  const EM = String.fromCharCode(0x2014);
  for (const f of files) check(`no em dash: ${f}`, !read(f).includes(EM));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
})();
