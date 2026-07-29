/**
 * scripts/diagnose_payment_settings_read.ts
 *
 * READ-ONLY. Two runs of loadPaymentSettings() disagreed (one saw the live key,
 * one saw the 'none'/sandbox default). loadPaymentSettings swallows read errors
 * and returns defaultPaymentSettings(), so a transient failure is INVISIBLE and
 * looks like "payments not configured". This probes the underlying selects
 * repeatedly and prints the raw PostgREST error each time.
 *
 * SELECTs only. Nothing is written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_payment_settings_read.ts [n]
 */

import { getServerClient } from '../src/core/db/supabase';
import { loadPaymentSettings } from '../src/shared/payments/config';

const N = Number(process.argv[2] ?? 10);
const PLATFORM = 'real-estate';
const BASE_COLUMNS =
  'platform_slug, active_provider, paddle_api_key, paddle_api_secret, paddle_webhook_secret, paddle_sandbox, paypro_api_key, paypro_api_secret, paypro_webhook_secret, paypro_sandbox';

async function main() {
  const sb = getServerClient();

  // How many rows actually exist? maybeSingle() ERRORS when >1 row matches.
  const all = await sb.from('payment_settings').select('platform_slug, active_provider, paddle_sandbox');
  console.log('=== payment_settings rows ===');
  if (all.error) console.log('  select error:', JSON.stringify(all.error));
  for (const r of all.data ?? []) console.log(`  platform=${r.platform_slug} provider=${r.active_provider} sandbox=${r.paddle_sandbox}`);
  const matching = (all.data ?? []).filter((r: any) => r.platform_slug === PLATFORM);
  console.log(`  rows with platform_slug='${PLATFORM}': ${matching.length}${matching.length > 1 ? '  <-- maybeSingle() will ERROR on this' : ''}`);

  console.log(`\n=== ${N} repeats of each select ===`);
  let tokenFail = 0, baseFail = 0, loaderDefault = 0;
  for (let i = 1; i <= N; i++) {
    const a = await sb.from('payment_settings').select(`${BASE_COLUMNS}, paddle_client_token`).eq('platform_slug', PLATFORM).maybeSingle();
    const b = await sb.from('payment_settings').select(BASE_COLUMNS).eq('platform_slug', PLATFORM).maybeSingle();
    const loaded = await loadPaymentSettings(sb, PLATFORM);
    const isDefault = loaded.active_provider === 'none' && !loaded.paddle_api_key;
    if (a.error) tokenFail++;
    if (b.error) baseFail++;
    if (isDefault) loaderDefault++;
    const line = [
      `#${String(i).padStart(2)}`,
      `withToken=${a.error ? 'ERR' : a.data ? 'ok' : 'no-row'}`,
      `base=${b.error ? 'ERR' : b.data ? 'ok' : 'no-row'}`,
      `loader=${isDefault ? 'DEFAULT(none/sandbox)' : `${loaded.active_provider}/sandbox=${loaded.paddle_sandbox}/key=${loaded.paddle_api_key ? 'yes' : 'no'}`}`,
    ].join('  ');
    console.log(line);
    if (a.error) console.log(`     withToken error: ${JSON.stringify(a.error)}`);
    if (b.error) console.log(`     base error     : ${JSON.stringify(b.error)}`);
  }

  console.log('\n=== Summary ===');
  console.log(`  withToken select failed : ${tokenFail}/${N}`);
  console.log(`  base select failed      : ${baseFail}/${N}`);
  console.log(`  loader returned DEFAULT : ${loaderDefault}/${N}  (this is what makes payments look "not configured")`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
