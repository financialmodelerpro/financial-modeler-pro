/**
 * verify-payments-structure.ts
 *
 * Proves the Phase F payment STRUCTURE without any live provider calls:
 *  - the adapter interface has both paddle + paypro present as STUBS, each
 *    returning a safe not-configured checkout result;
 *  - the shared webhook signature primitive really verifies (valid passes,
 *    tampered + wrong-secret + missing-signature fail);
 *  - the masked config never carries a raw secret (secrets never reach a client);
 *  - the plan provider-id pick + the baseline are correct;
 *  - the webhook route REUSES the shared setUserPlan (does not duplicate the
 *    subscription write), verifies the signature before parsing, and the
 *    checkout route returns the placeholder when the active provider is none.
 *
 * Run: npx tsx scripts/verify-payments-structure.ts
 */
import fs from 'fs';
import path from 'path';
import { allAdapters, getAdapter, PAYMENT_PROVIDERS } from '../src/shared/payments/registry';
import { hmacSha256Hex } from '../src/shared/payments/signature';
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

console.log('=== Adapter interface (both stubs) ===');
const adapters = allAdapters();
check('registry exposes paddle + paypro', PAYMENT_PROVIDERS.join(',') === 'paddle,paypro' && adapters.length === 2);
for (const a of adapters) {
  check(`${a.provider} is a stub (implemented === false)`, a.implemented === false);
  check(`${a.provider} parseEvent returns unknown`, a.parseEvent('{}').type === 'unknown');
}

(async () => {
  const cfg: ProviderConfig = { provider: 'paddle', apiKey: 'k', apiSecret: 's', webhookSecret: 'whsec', sandbox: true };
  for (const provider of PAYMENT_PROVIDERS) {
    const a = getAdapter(provider);
    const res = await a.createCheckout(
      { planKey: 'pro', interval: 'monthly', providerPriceId: 'price_x', userId: 'u1', userEmail: 'a@b.com' },
      { ...cfg, provider },
    );
    check(`${provider} checkout returns not_configured (no charge)`, res.ok === false && res.status === 'not_configured');
  }

  console.log('=== Webhook signature verification (real HMAC) ===');
  const body = JSON.stringify({ event: 'subscription.activated', id: 'evt_1' });
  const secret = 'whsec_test';
  const goodSig = hmacSha256Hex(body, secret);
  const adapter = getAdapter('paddle');
  const withSecret: ProviderConfig = { ...cfg, webhookSecret: secret };
  check('valid signature passes', adapter.verifyWebhook(body, goodSig, withSecret).valid === true);
  check('valid signature with sha256= prefix passes', adapter.verifyWebhook(body, `sha256=${goodSig}`, withSecret).valid === true);
  check('tampered body fails', adapter.verifyWebhook(body + 'x', goodSig, withSecret).valid === false);
  check('wrong secret fails', adapter.verifyWebhook(body, goodSig, { ...cfg, webhookSecret: 'other' }).valid === false);
  check('missing signature fails', adapter.verifyWebhook(body, null, withSecret).valid === false);
  check('missing secret fails', adapter.verifyWebhook(body, goodSig, { ...cfg, webhookSecret: null }).valid === false);

  console.log('=== Config masking (secrets never reach the client) ===');
  const row: PaymentSettingsRow = {
    ...defaultPaymentSettings('real-estate'),
    active_provider: 'paddle',
    paddle_api_key: 'KEY_SECRET_VALUE', paddle_api_secret: 'API_SECRET_VALUE', paddle_webhook_secret: 'WEBHOOK_SECRET_VALUE', paddle_sandbox: false,
  };
  const masked = maskPaymentSettings(row);
  const maskedJson = JSON.stringify(masked);
  check('mask carries active_provider', masked.active_provider === 'paddle');
  check('mask reports paddle configured', masked.paddle.configured === true && masked.paddle.has_api_key && masked.paddle.has_api_secret && masked.paddle.has_webhook_secret);
  check('mask reports paypro not configured', masked.paypro.configured === false);
  check('mask preserves sandbox flag', masked.paddle.sandbox === false);
  check('mask contains NO raw secret', !maskedJson.includes('KEY_SECRET_VALUE') && !maskedJson.includes('API_SECRET_VALUE') && !maskedJson.includes('WEBHOOK_SECRET_VALUE'));

  console.log('=== Provider price id pick + config + baseline ===');
  const plan: PlanProviderIds = { plan_key: 'pro', paddle_price_id_monthly: 'pmon', paddle_price_id_annual: 'pann', paypro_product_id: 'pp1' };
  check('paddle monthly id', planProviderPriceId(plan, 'paddle', 'monthly') === 'pmon');
  check('paddle annual id', planProviderPriceId(plan, 'paddle', 'annual') === 'pann');
  check('paypro id (interval-agnostic)', planProviderPriceId(plan, 'paypro', 'monthly') === 'pp1');
  check('default active provider is none', defaultPaymentSettings('real-estate').active_provider === 'none');
  check('providerConfigFrom maps paypro fields', providerConfigFrom({ ...row, paypro_api_key: 'x', paypro_webhook_secret: 'y' }, 'paypro').webhookSecret === 'y');
  check('baseline plan key defined', typeof BASELINE_PLAN_KEY === 'string' && BASELINE_PLAN_KEY.length > 0);

  console.log('=== Route structure (reuse, not duplicate; verify before parse) ===');
  const webhook = read('app/api/payments/webhook/[provider]/route.ts');
  check('webhook imports shared setUserPlan', /import\s*\{[^}]*setUserPlan[^}]*\}\s*from\s*'@\/src\/shared\/entitlements\/setUserPlan'/.test(webhook));
  check('webhook calls setUserPlan', /setUserPlan\(/.test(webhook));
  check('webhook does NOT duplicate the subscription_plan write', !/\.update\(\s*\{[^}]*subscription_plan/.test(webhook) && !/subscription_plan\s*:/.test(webhook));
  check('webhook verifies signature before parseEvent', webhook.indexOf('verifyWebhook(') < webhook.indexOf('parseEvent('));
  check('webhook stub-guards on !implemented / unknown', /adapter\.implemented/.test(webhook) && /adapter_not_implemented/.test(webhook));

  const checkout = read('app/api/payments/checkout/route.ts');
  check('checkout returns placeholder when provider none', /active_provider === 'none'/.test(checkout) && /status:\s*'placeholder'/.test(checkout));
  check('checkout reads provider price id from plan', /planProviderPriceId\(/.test(checkout));
  check('checkout never sets a plan (does not call setUserPlan)', !/setUserPlan\(/.test(checkout));

  const adminCfg = read('app/api/admin/payments/config/route.ts');
  check('admin config GET returns masked view', /maskPaymentSettings\(/.test(adminCfg));
  check('admin config never selects raw secrets into a client response', !/config:\s*row/.test(adminCfg));

  console.log('=== No em dashes in new payment files ===');
  const files = [
    'src/shared/payments/types.ts', 'src/shared/payments/signature.ts',
    'src/shared/payments/registry.ts', 'src/shared/payments/config.ts',
    'src/shared/payments/adapters/paddle.ts', 'src/shared/payments/adapters/paypro.ts',
    'app/api/payments/checkout/route.ts', 'app/api/payments/webhook/[provider]/route.ts',
    'app/api/admin/payments/config/route.ts', 'app/admin/payments/page.tsx',
  ];
  const EM = String.fromCharCode(0x2014);
  for (const f of files) check(`no em dash: ${f}`, !read(f).includes(EM));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
})();
